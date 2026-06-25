---
slug: mysql-hang-runc-freeze-d-state
title: "MySQL 偶发卡死 2s：runc freeze 超时 + D 状态进程的合谋"
date: 2024-03-26
published: true
tags: [Kubernetes, runc, systemd, cgroup, MySQL, kubelet, cpu-manager, D-state, Linux]
---

线上 MySQL 容器隔一段时间会出现一次"卡 2s"——业务方的监控看是连接处理瞬间停顿，没有明显告警，但偶发存在。从 runc 日志里能找到一行非常显眼的 `Info`：

```
freeze container before SetUnitProperties failed: unable to freeze
```

这条日志的时间点和业务卡顿的时间点完全对得上。这是我们 [上一篇博客](/posts/containerd-systemd-cgroup-urandom-eperm)（`/dev/urandom` 偶发 EPERM）的姊妹篇——同一条 `freeze → update → thaw` 链路，这次没有出 EPERM，但留下了 2s 的"假死"。根因是 cgroup 里有 D 状态进程，导致 freezer 永远停在 `FREEZING` 而不能进入 `FROZEN`，runc 死等 2s 超时再放行。

<!--more-->

## 一、结论

### 故障链

1. **kubelet 1.17 的 cpu-manager** 每 10s 定时通过 CRI 的 `UpdateContainerResource` 接口刷一次 cpuset 信息——即使容器的 cpuset 根本没变；
2. CRI 调用透传给 runc，**runc 在 systemd cgroup driver 下做 update 时，必须先 freeze 容器**——因为 systemd 的 dbus 接口不能 deny 单个设备，更新设备规则只能 deny all 再回放整张 allow 列表，中间窗口里业务访问设备会拿到 EPERM；
3. runc 调用 freezer cgroup 写入 `FROZEN`，然后轮询 `freezer.state`——按内核语义，只要 cgroup 里有任何一个进程是 D 状态（不可中断睡眠），整个 cgroup 就会一直停在 `FREEZING`，永远进不到 `FROZEN`；
4. runc 自旋 1000 次（约 2s）超时放弃，记一条 `Info` 日志，然后**继续往下走 update**；
5. 整个 cgroup 在这 2s 内被冻结，**MySQL 的正常线程也跟着躺平 2s**——这就是业务方感知到的"卡死"。

### 解决路径（按优先级）

1. **关闭 kubelet 的 cpu-manager**（业务无绑核需求时可行）；
2. **优化 cpu-manager**：按需调用 `UpdateContainerResource`（容器创建/cpuset 实际变化时），不要 10s 一次无脑刷；
3. **长期方案**：cgroup driver 从 systemd 换成 cgroupfs，跳过 systemd 那套 deny+allow 流程；
4. **内核侧**：FROZEN 跳过 D 状态进程（最理想，但改动最深）。

## 二、问题描述

业务方反馈 MySQL 偶发卡死，频次很低但确实存在：

- 2023-08-15：一次
- 2024-03-26：本周这次

两次现象一致，但根因略有差异——这次是 freezer 卡在 FREEZING，上次是 systemd dbus 卡住。本文以本次（2024-03）为主线，把两次都串起来讲。

## 三、现场信息收集

### 3.1 MySQL 进程在 D 状态

从节点抓 task state，业务卡顿的时间点上 MySQL 的某些线程确实在 D（不可中断睡眠）状态。

### 3.2 runc 日志

```
... freeze container before SetUnitProperties failed: unable to freeze  2024-03-25T19:27:59
... freeze container before SetUnitProperties failed: unable to freeze  2024-03-25T21:13:07
... freeze container before SetUnitProperties failed: unable to freeze  2024-03-26T00:12:55
... freeze container before SetUnitProperties failed: unable to freeze  2024-03-26T04:10:27
... freeze container before SetUnitProperties failed: unable to freeze  2024-03-26T07:23:59
... freeze container before SetUnitProperties failed: unable to freeze  2024-03-26T07:53:27
... freeze container before SetUnitProperties failed: unable to freeze  2024-03-26T16:51:38
```

业务卡顿时间点 ↔ runc freeze 失败时间点 ↔ MySQL 线程 D 状态时间点——三者**完全重合**。

## 四、几个需要先澄清的假设

### 4.1 是 freeze 让 MySQL 进了 D 吗？

最初有同学怀疑：是不是 runc FROZEN 操作把 MySQL 进程冻到了 D 状态？

手动验证：单独对一个 cgroup 执行 freezer state=FROZEN，观察里面进程的 state——结论是**进程冻结和进程状态没有关系**，被冻结的进程不会因为冻结而变 D。看内核 `kernel/cgroup/cgroup-v1.c` 和 `kernel/freezer.c` 的实现也能确认：freezer 通过 task->frozen flag 标记，与 task->state 是两套机制。

**所以 MySQL 进入 D 是它自己的事**（典型场景是 IO wait、锁等待），不是 runc 导致的。

### 4.2 那卡死到底是 D 状态导致的还是 freeze 导致的？

业务现场可稳定复现，所以可以做对照实验。

我们做了一个 hook runc 的脚本——**完全跳过 `runc update`**：

```bash
#!/bin/bash
BIN_ROOT="/bin"
RUNC_NAME="runc"

function invoke_runc() {
    local back="$BIN_ROOT/$RUNC_NAME.original"
    [[ ! -f $back ]] && back="$BIN_ROOT/$RUNC_NAME"

    # 跳过所有 update 调用
    echo "$@" | grep -w update -q
    [[ $? == 0 ]] && exit 0

    $back --debug "$@"
}

invoke_runc "$@"
```

把这个脚本铺到出问题的节点上，把原 `/bin/runc` 备份为 `runc.original`，让所有 `update` 调用变成 no-op。

DBA 同学观察了相当长一段时间：**没有业务卡顿**。

结论很清晰：**卡顿是 runc 的 freeze 操作引起的，不是 MySQL D 状态本身**。D 状态只是把 freeze 时间拉长到 2s 的"放大器"。

## 五、runc freeze 超时的两种姿势

`doFreeze(FROZEN)` 的实现大致是：

1. 往 `freezer.state` 写 `FROZEN`；
2. 轮询读 `freezer.state`，每 10ms 一次：
   - 如果是 `FREEZING`，继续等；
   - 直到状态不是 `FREEZING`，或者超过 2s。

也就是说 runc 给 freeze 留了 2s 的窗口，超时后会判定失败，**但代码会继续往下走 `updateCgroup`**——这是关键。

### 5.1 第一种：FROZEN 成功，但 update 慢（2023-08）

`doFreeze(FROZEN)` 成功返回，但是接下来 `updateCgroup` 走 systemd dbus 卡住——systemd-dbus 偶发性慢。这种情况下容器被正常冻结，然后在 dbus 调用期间一直保持冻结状态，业务感知就是"卡了 N 秒"，N 取决于 dbus 多慢。

**原因：systemd dbus 响应慢。**

### 5.2 第二种：FREEZING 超时（2024-03 本次）

这次是 `doFreeze(FROZEN)` 根本没成功——freezer.state 一直停在 `FREEZING`。

向内核同学求证后得到答案：**只要 cgroup 内有任意一个进程是 D 状态**（不可中断睡眠），FROZEN 翻转就无法完成，整个 cgroup 会一直停在 `FREEZING`。其他可中断的进程在 FREEZING 状态下其实已经被冻结，只是整个 cgroup 的总状态机不能进入 `FROZEN`。

runc 等不到 `FROZEN`，自旋 2s 后放弃。问题是这 2s 里：

- 大部分线程已经被实际冻结（只是 cgroup 的状态字段是 `FREEZING` 而不是 `FROZEN`）；
- 业务的所有非 D 线程都在停摆；
- 然后 runc 放弃 freeze，去走 update——update 又会持续一段时间——加起来就是业务感知到的 2s+ 卡死。

**原因：cgroup 中有 D 状态进程，导致 freezer 状态机停在 FREEZING。**

## 六、为什么非要 freeze？

回顾一下：systemd 的 dbus 接口在更新 device cgroup 时，是没有"deny 单个设备"的能力的——只能 `deny all` 再回放整张 allow 列表。所以 runc 在 systemd cgroup driver 模式下，必须在 update 之前先把容器冻住，免得业务进程在 deny→allow 的中间窗口里访问设备拿到 EPERM。

这套保护本身设计是合理的，runc 注释也写得很清楚：

```go
// We have to freeze the container while systemd sets the cgroup settings.
// The reason for this is that systemd's application of DeviceAllow rules
// is done disruptively, resulting in spurrious errors to common devices.
if err := m.Freeze(configs.Frozen); err != nil {
    logrus.Infof("freeze container before SetUnitProperties failed: %v", err)
}
```

之前在 runc 上还专门解过一个 issue（[opencontainers/runc#3804](https://github.com/opencontainers/runc/pull/3804)），就是 D 状态进程导致冻结失败后权限丢失的问题。

但是 freeze 失败后**只打个 Info 日志、继续 update** 这件事，本身就是个雷：

- 失败时如果继续往下走 systemd dbus 更新设备规则 → 业务会踩 EPERM（urandom 那次）；
- 失败时如果是 FREEZING 走到 2s 超时 → 业务被冻结 2s（这次 MySQL）。

**保护机制失败时静默降级是危险的。**

## 七、runc update 的源头：kubelet cpu-manager

为什么这个 update 会被周期性触发？

在 Kubernetes 1.17 及更早版本，**`cpu-manager` 会每 10s 通过 CRI 的 `UpdateContainerResource` 接口刷一次 cpuset**——不管 cpuset 实际有没有变化。每次刷下来都会触发：

```
kubelet cpu-manager (10s tick)
    │
    ▼
CRI: UpdateContainerResources
    │
    ▼
containerd → runc update
    │
    ├─► freeze (可能失败超时 2s)
    ├─► systemd dbus 更新 cgroup
    └─► thaw
```

整条链路在没有 D 状态进程、systemd 健康的情况下基本无感知。但只要业务进入了 IO/锁等待状态产生 D 进程，这条链路上的 freeze 步骤就会变成 2s 的"业务暂停按钮"。

**最讽刺的是：很多业务根本不需要 cpu-manager 来绑核**——它们没有 cpuset 调整需求，但每 10s 一次的"无用 update"就这样把雷埋在了生产环境里。

## 八、解法

### 8.1 关闭 cpu-manager（最快）

业务没有绑核需求时直接关闭 kubelet 的 cpu-manager。代价：失去为 Guaranteed Pod 做静态 CPU 分配的能力。对纯 CFS 调度业务无影响。

### 8.2 优化 cpu-manager：按需 update（中期）

让 cpu-manager 只在容器**创建时**或 **cpuset 实际变化时**调用 `UpdateContainerResource`，不要 10s 一次无脑刷。这是上游已经在做的方向（更新版本的 cpu-manager 已经改成事件驱动）。低版本集群可以打 patch。

### 8.3 cgroup driver 换 cgroupfs（长期）

`cgroupfs` driver 不走 systemd dbus，没有"deny all 再 allow"那一套 disruptive 行为，runc 也就不需要 freeze 保护。整条链路上的隐患都消失了。

但代价不小：cgroup driver 切换需要节点 drain + 重启 kubelet/containerd，集群规模大时排期长。

### 8.4 内核跳过 D 状态进程的 FROZEN（理想）

最干净的修复：让 freezer 在遇到 D 状态进程时跳过它们，而不是把整个 cgroup 卡在 FREEZING。这需要内核侧改 freezer 状态机的语义。

## 九、几个反思

**1. 同一个保护机制可以以两种姿势伤害业务**：上次（urandom）是因为 freeze 失败、保护失效，业务踩 EPERM；这次（MySQL）是因为 freeze 失败、runc 自旋等待 2s，业务被冻结 2s。**同一段代码（"freeze 失败时只打日志继续走"）在两种场景下都是雷**——一个让你拿 EPERM，一个让你假死 2s。runc 的修复方向应该是"freeze 失败必须中止 update 并报错"。

**2. 业务进 D 不是 bug，是常态**：MySQL 在做 fsync、做 IO、等内核锁的时候进 D 都是正常的。但只要进 D，就触发了 freezer 的死循环行为。一个看似不相干的"调度器周期性同步 cpuset"动作就被这个常态行为放大成"业务卡 2s"。

**3. "10s 一次无变化的 update"是典型的过度同步**：kubelet 1.17 cpu-manager 这种"每 N 秒 reconcile 全量"的模式，在没有变化时本应是 no-op，但因为下层 runc + systemd 的实现细节，每一次"no-op"都在真实地动 cgroup。设计周期性 reconcile 时要意识到：**下层每次执行的实际代价可能远高于你的预期**。

**4. 日志级别和故障严重程度脱钩**：runc 把 `unable to freeze` 打成 `Info`。但实际上它代表"保护机制失败，接下来的 update 会让业务感知到副作用"——这至少应该是 `Warn`，配合上层重试逻辑。生产环境很多隐性问题都藏在这种"低级别日志、高影响后果"的设计里。

**5. 跨层问题没有人为它负责**：这个问题涉及 kubelet（10s 同步）、CRI（透传 Resources）、containerd（包装请求）、runc（freeze + update）、systemd（dbus + cgroup driver）、内核（freezer 状态机）、业务（D 进程）。任何一层单独看都没"错"，但它们组合起来对业务来说是 2s 假死。**这种问题最难调，因为不知道该去哪个 issue tracker 提 bug**。

## 十、相关链接

- [runc: D-state cgroup freeze workaround (#3804)](https://github.com/opencontainers/runc/pull/3804)
- [kubelet cpu-manager 演进](https://github.com/kubernetes/enhancements/tree/master/keps/sig-node/2625-cpumanager) — 1.17 之后的版本逐步改为事件驱动
- [systemd cgroup.c](https://github.com/systemd/systemd/blob/main/src/core/cgroup.c) — `DeviceAllow` 的 deny+allow 实现

---

*本文是 2024-03 一次 MySQL 卡死问题的复盘，前后串联了 2023-08 同类问题。文中内部域名/节点名/具体业务方信息已脱敏。*
