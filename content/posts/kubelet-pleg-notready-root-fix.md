---
slug: kubelet-pleg-notready-root-fix
title: "Kubelet PLEG NotReady 根治：从单点修复到系统性方案"
date: 2024-02-20
published: true
tags: [Kubernetes, containerd, Kubelet, PLEG, Overlayfs, CRI, Linux]
---

PLEG NotReady 是这一两年里我们集群上故障案例最多的几个稳定性问题之一——批量 NotReady、节点驱逐、短任务异常重启，一年至少发生几次大故障，每次影响数十个业务、半小时以上。前面写过 [短任务场景下 PLEG NotReady 排查](/blog/containerd-pleg-notready-short-task/) 和 [containerd init 容器卡在 Running](/blog/containerd-init-container-stuck-running/) 两篇，都是单点定位。这篇是系统性根治方案：从原理到上线落地的完整路径。

<!--more-->

## 一、为什么需要"根治"

集群历史上出现过多起批量 NotReady 故障案例（规模 > 10 台、累计 > 3 次），影响业务数量数十个，单次时长达 30 分钟以上。每次根因都不一样——有的是 IO 压力高、有的是 dbus 超时、有的是 init 容器卡退出——但**底层路径都指向同一处：containerd CRI 插件的 Status 锁临界区过大或过多**。

在前两篇里我们已经局部修复过：

- [PLEG 短任务场景排查](/blog/containerd-pleg-notready-short-task/)：定位到 `umount2` 慢 + Status 锁占用，方案是给退出中的容器 short-circuit Update；
- [containerd 容器读写层分盘方案](https://github.com/containerd/containerd/issues?q=overlay+split)：在另一类高 IO 场景下把元数据 IO 和业务 IO 分到不同盘上。

但这两个修复都是"窄修复"：一个针对短任务退出场景、一个针对元数据 IO。集群规模大了之后，**新的 PLEG NotReady 仍然在以新的姿势出现**——比如 `task.Update` 在 Running 容器上也会因为 dbus 超时而卡住。

所以这次的目标是：**把 Status 锁的所有长耗时调用都摸一遍，建立一个体系化的治理路径**，而不是"出一个修一个"。

## 二、PLEG NotReady 的本质

### 2.1 PLEG 怎么工作

PLEG (Pod Lifecycle Event Generator) 是 Kubelet 的一个子模块：

- 周期性（默认 ~1s，最长 3min）从 container runtime 拉取最新容器列表；
- 与本地 cache 对比，生成 lifecycle 事件 → 推到 channel；
- Kubelet 主循环消费事件，做调度/状态同步。

**判 NotReady 的硬阈值**：如果 PLEG 在 3 分钟周期内没有完成一次 relist，Kubelet 认为节点异常，上报 API Server，节点被打 NotReady。

### 2.2 relist 慢在哪

relist 的实现是：调 CRI 的 `ListContainers`，遍历每个容器拉 Status。在 containerd 这一侧：

```
Kubelet
  └─► CRI ListContainers
        └─► 遍历容器
              └─► Container.Status.Get()    ← 加读锁
                    └─► 有人持写锁就 block
```

只要**任何一个容器**的 Status 写锁被长时间持有，整个 ListContainers 就拉不完，relist 就会超时。

### 2.3 谁在长时间持 Status 写锁

把 containerd CRI 插件代码里 Status 写锁的临界区过一遍，可以总结成两类：

1. **`UpdateSync` 系列**（4 处）：会同步落盘，**耗时受磁盘 IO 影响**；
2. **`Update` 系列**（6 处，其中 1 处临界区耗时长）：会在锁内调 shim 的 `task.Update` RPC + containerd 的 Spec 更新，**耗时受 shim 健康状况影响**。

实际故障里看到过的"慢源头"至少有这几种：

| 慢的源头 | 在哪一类 | 触发条件 |
|---------|---------|---------|
| `umount2(rootfs)` 阻塞 sync | Update | 容器退出时高 IO + 脏页多 |
| 元数据写盘慢 | UpdateSync | 系统盘 IO 压力 |
| `task.Update` dbus 超时 | Update | 在 Running 容器上 update，systemd cgroup driver 下走 dbus |

每一个都能让 ListContainers 卡 3 分钟以上。

## 三、根治方案

针对两类慢源头分两条路推进：

### 方案 A：overlayfs `volatile` 挂载——根除 umount sync

**思路**：让 overlayfs 在 umount 时不再触发 sync，从源头上消除"容器退出 → umount 慢"这条因果链。

- 内核要求：5 系内核或我们后端打了对应补丁的版本（4.18 系列）已支持 `volatile` 挂载选项；
- containerd 要求：1.6.24 已适配 `volatile` 挂载（[containerd/containerd#8676](https://github.com/containerd/containerd/pull/8676)）；
- 升级方式：升级 containerd + 在 config 里加 `volatile` mount option；
- 局限：**只对增量容器生效**——存量容器不受影响。

### 方案 B：UpdateContainerResources 跳过退出中容器——避免锁内长 RPC

**思路**：从代码层修改容器状态机——给 Status 加一个 `Stopping` 标志位，容器退出时立即标记，update_resource 路径看到 Stopping 就直接返回，不再调 shim。

核心 diff（简化版）：

```go
// 容器资源更新方法：跳过退出中和删除中的容器
func (c *criService) updateContainerResources(ctx context.Context,
    status containerstore.Status) (retErr error) {

    if status.Removing || status.Stopping {
        return fmt.Errorf("container %q is in removing or stopping state", id)
    }
    // ...
}

// 容器退出事件处理：第一时间标记 Stopping
func handleContainerExit(ctx context.Context, e *eventtypes.TaskExit, cntr containerstore.Container) error {
    // First we need to update the status to Stopping
    // to avoid container update from update_resource
    _ = cntr.Status.Update(func(status containerstore.Status) (containerstore.Status, error) {
        status.Stopping = true
        return status, nil
    })
    // ... 后续 task.Delete + UpdateSync ...
}

// Status 结构体新增字段
type Status struct {
    // ...
    Stopping bool `json:"-"`   // 不持久化，重启自然清零
}
```

要点：

- `Stopping` 是**进程内状态**，不持久化（`json:"-"`），containerd 重启时自然清零；
- 仅在容器退出事件触发时设置一次，UpdateSync 完成后由容器对象回收一并清理；
- 兼容性好——对正常运行的容器毫无影响。

### 两个方案对比

| 维度 | 方案 A（volatile） | 方案 B（Stopping flag） |
|------|-------------------|-------------------------|
| 推全难度 | 高（需要内核 ≥ 4.18 带补丁/5.x，且要升 containerd） | 低（只需 containerd 升级 + 重启） |
| 对存量容器是否生效 | 否 | 是 |
| 是否彻底解决 umount 刷盘 | 是 | 否（只是让 update_resource 不被 umount 阻塞） |
| 风险 | 内核 + containerd 双依赖 | 仅 containerd 改动，diff 小 |

最终选择：**两个并行推进**——B 先上（短期止血），A 跟上（长期根除）。

### 方案 C（兜底）：CRI status 单独切盘

针对 `UpdateSync` 这条线（元数据 IO 慢），做元数据切盘——把 CRI 的 status 数据放到独立盘上：

```bash
root_dir = "/run/containerd/io.containerd.grpc.v1.cri"

# 把存量 status 数据迁到 tmpfs 上的 /run（避免重启丢数据需先做 rsync 同步）
rsync -rc /media/disk1/containerd/io.containerd.grpc.v1.cri/ \
          /run/containerd/io.containerd.grpc.v1.cri
```

权衡：tmpfs 速度快但占内存；如果集群内存紧张，可以单独挂个 SSD 分区给 status。

## 四、上线落地

### 4.1 灰度

按 5+1 的对照组上线方案 B：

- 5 台机器升级到带方案 B 的 containerd（观察组）；
- 1 台机器保持不变（对照组）；
- 同样的业务负载、同样的资源池；
- 观察一个月：PLEG NotReady 频次、relist P99 耗时、`UpdateContainerResources` 失败率。

灰度结果（按指标）：

- 观察组：未再触发 PLEG NotReady；
- 对照组：仍间歇性 NotReady（约 1-2 次/周）；
- 业务无回归。

### 4.2 推全 + 回滚预案

发版用 RPM，回滚也走 RPM。脚本核心逻辑：

```bash
# 主流程：升级到新版
rpm -Uvh containerd.io-<new>.rpm

# 回滚：降级到老版（注意要 --oldpackage）
rpm -Uvh --oldpackage containerd.io-<old>.rpm
```

关键点：

1. 包文件用内部存储托管，下载脚本封一层；
2. 回滚必须用 `--oldpackage`，否则 RPM 会拒绝降级；
3. 升级 containerd 不重启容器（只 daemon-reload 一次新进程）；
4. 全量推全到所有相关资源池后，PLEG NotReady 全集群 30 次/天 → 0 次/天，外网资源池故障频次显著下降。

### 4.3 后续补充：dbus 超时

推全方案 B 之后又遇到一种新姿势：**Running 状态的容器，`task.Update` 也会超时**——但这次不是 umount 慢，而是 systemd cgroup driver 下 `task.Update` 走 dbus，dbus 本身在某些情况下卡住。

短期解法：重装 polkit 并重启 dbus，恢复正常。但这暴露了一个新问题——**Status 锁内调 dbus 本身就是个隐患**，社区已有相关讨论，是另一个独立的治理项。

## 五、收益

总结一下几个量化收益：

- **PLEG NotReady 频次**：30 次/天 → 0 次/天；
- **外网资源池故障**：减少 2-3 次/年；
- **短任务高优资源池**：减少 1 次/天驱逐异常，避免 ~80 个/天的短任务实例重启；
- **业务侧**：影响业务数量从十几个 → 0（PLEG 这条线）。

## 六、回头看

PLEG NotReady 本质是**底层基础设施的"长尾抖动"在上层状态机上的放大**：

- 一次 umount 慢、一次 dbus 卡、一次磁盘抽风——单看都不是大事；
- 经过 Status 锁这个**串行咽喉**一放大，就变成"一个容器卡住整台机器"；
- 再经过 PLEG 3 分钟硬阈值这个**总开关**一截断，就变成 NotReady → 驱逐 → 业务故障。

所以根治这类问题，关键不是修每一处单独的慢源头，而是：

1. **把串行的咽喉拆掉**——比如本文的 Stopping 标志位，让退出中容器不进 Update 路径；
2. **把硬阈值上的依赖减到最小**——比如 volatile 挂载、元数据切盘，让 ListContainers 永远不再依赖业务 IO；
3. **拒绝在锁内调外部 RPC**——dbus 那条线就是反面教材，是下一阶段要重点治理的。

接下来一阶段的目标，是把 containerd CRI 插件里**所有"锁内调外部 RPC"的位置**都梳理一遍——这是这次根治方案的下一个 chapter。

## 七、附录

- [短任务场景下 PLEG NotReady 排查](/blog/containerd-pleg-notready-short-task/) — 单点定位
- [containerd init 容器卡在 Running](/blog/containerd-init-container-stuck-running/) — 同一条 umount 慢链路上的另一种翻车姿势
- [containerd PR #8676 - support overlay volatile mount](https://github.com/containerd/containerd/pull/8676)
- [Kubelet PLEG 设计文档](https://github.com/kubernetes/community/blob/master/contributors/design-proposals/node/pod-lifecycle-event-generator.md)
