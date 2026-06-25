---
slug: containerd-systemd-cgroup-urandom-eperm
title: "/dev/urandom 偶发 Operation not permitted：runc + systemd cgroup driver 下的设备权限抖动"
date: 2023-03-29
published: true
tags: [Kubernetes, containerd, runc, systemd, cgroup, urandom, Linux]
---

业务侧反馈某个广告检索服务的 Pod 频繁 core dump，看错误信息是访问 `/dev/urandom` 时拿到 `Operation not permitted`：

```
libc++abi: terminating with uncaught exception of type std::__1::system_error:
  random_device failed to open /dev/urandom: Operation not permitted
```

最离谱的是同样的镜像、同样的 K8s 集群，在 docker 运行时的节点稳定，containerd 运行时的节点必现。一个原本应该一直存在的设备权限，怎么会"短暂消失"？这篇博客是这次排查的复盘——结论非常具体：**runc 在 systemd cgroup driver 下做 update 时，会先 `deny all` 再回放整张 allow 列表，给业务留下了一个亚秒级的"无权限窗口"**。

<!--more-->

## 一、结论先行

### 根因

`runc` + `systemd` cgroup driver 下，做容器资源 update 时的 device cgroup 更新流程是：

1. **先 `deny all`**：往 `devices.deny` 写 `a`，把所有设备权限清掉；
2. **再回放整张 allow 列表**：对每个设备类型（`c 1:*`、`b 8:*` 等等）逐条写回 `devices.allow`。

这个过程不是原子的。在 deny 之后、allow 写完之前，**容器内的进程访问任何设备都会拿到 `EPERM`**。allow 列表越长，窗口越宽。

### 三个必要条件（缺一不可）

1. **运行时是 containerd**：containerd 在 `UpdateContainerResources` 时把整份 OCI Linux Resources（包括 devices 配置）传给 runc；runc 跑 systemd driver 时会走上面那条 deny→allow 路径。docker 在同样的 CRI 调用下只传 `cpuset` 这一个字段，没有 device 触发，systemd 不会重写设备规则。
2. **业务进程在 freezer cgroup 上冻结失败**：runc 本来想在 update 前冻住容器以避免设备规则更新被业务感知到，但是 freeze 重试 1000 次（约 2s）失败后会**直接放弃冻结、继续 update**，于是抖动窗口暴露给业务。
3. **业务对设备访问频率极高（~毫秒级）**：抖动窗口只有亚秒级；正常业务访问 `/dev/urandom` 的频率是分钟级、秒级，根本踩不上。但这个广告检索业务每条请求都要从 `std::random_device` 取熵，几乎是每毫秒读一次。

这三条同时具备，才会出现"`/dev/urandom` 偶发 EPERM 然后 abort"。

### 修复路径

1. **业务侧**：降低对随机设备的访问频次（侵入式）；
2. **runc 侧**：freeze 失败时不要继续 update，直接报错——已合并到上游；
3. **业务侧**：避免大量 D 状态进程，让 freezer 能正常生效。

后面把过程写一遍。

## 二、现场对比

最初的现象是同一镜像在两台机器上行为不同：

| 主机 | 运行时 | 现象 |
|---|---|---|
| `node-A` | containerd | 业务必 core |
| `node-B` | docker | 业务正常 |

进容器看 device cgroup，两边的 `devices.list` 也不一样。

**问题机（containerd）**：

```
b 8:* m       b 9:* m       ...
c 1:* m       c 4:* m       c 5:* m
c 7:* m       c 10:* m      ...
c 1:3 rwm     c 1:5 rwm     c 1:7 rwm
c 1:8 rwm     c 1:9 rwm     ...
```

**正常机（docker）**：

```
c 136:* rwm   c 5:2 rwm   c 5:1 rwm   c 5:0 rwm
c 1:9 rwm     c 1:8 rwm   c 1:7 rwm   c 1:5 rwm
c 1:3 rwm
b *:* m       c *:* m     c 10:200 rwm
```

两份列表里 `/dev/urandom`（`c 1:9`）都在，权限都是 `rwm`——也就是说，**稳态下两边权限都是对的**。问题一定出在某个瞬时状态。

## 三、确认窗口存在

### 3.1 准备复现环境

挑一台 containerd 节点，部署一个简单 Deployment 钉到这台机器上，业务镜像就用出问题的那个：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: random-read-device-test
spec:
  replicas: 1
  template:
    spec:
      nodeName: debug-node
      containers:
      - image: internal-registry/ad/target_search_server:1.0.x
        name: random-read-device-test
        command: [sleep]
        args: [infinity]
```

测试程序：一个简单的多线程不断从 `/dev/urandom` 读熵的 C++ 程序（使用 `std::random_device`）。

进入容器 cgroup + namespace：

```bash
cid=$(crictl ps | grep random-read-device-test | awk '{print $1}')
pid=$(crictl inspect $cid | jq '.info.pid')
cg=$(crictl inspect $cid | jq -r '.info.runtimeSpec.linux.cgroupsPath')
cgpath=/$(echo $cg | awk -F '-' '{print $1 ".slice/" $1 "-" $2 ".slice"}')/$(echo $cg | awk -F ':' '{print $1 "/" $2 "-" $3 ".scope"}')

cgexec -g devices:$cgpath -g freezer:$cgpath nsenter -t $pid -m bash
```

启动测试程序：

```
[root@debug-node ~]# time ./read_urandom
threads=1
spawning read-urandom thread: 0......
libc++abi: terminating with uncaught exception of type std::__1::system_error:
  random_device failed to open /dev/urandom: Operation not permitted
Aborted

real    0m8.431s
```

**10s 内稳定复现。**

### 3.2 实验一：停掉 kubelet，看问题是否消失

```bash
sudo systemctl stop kubelet
```

再跑测试程序：

```
[root@debug-node ~]# time ./read_urandom
threads=1
spawning read-urandom thread: 0......
^C

real    1m24.155s
```

跑了 1 分多钟没出问题。**触发源确定是 kubelet 在某个周期性动作里调到 containerd**——CRI 调用链 `kubelet → CRI → containerd → runc`。

### 3.3 抓 cgroup 写入

用一个 bpftrace 脚本观察 `cgroup_file_write`：

```c
kprobe:cgroup_file_write
{
    $of = ((struct kernfs_open_file *)arg0);
    $path = (struct path *)$of->file->f_path;
    $name = $path->dentry->d_name.name;
    $pname = (struct dentry *)$path->dentry->d_parent->d_name.name;
    printf("write cgroup by %s<%d>: %s/%s: %s\n",
        comm, pid, str($pname), str($name), str(arg1));
}
```

跑起来后能清楚看到：每隔 10s 左右就会有一次写 `devices.deny=a`，紧接着是一连串往 `devices.allow` 写各种设备规则。两次写之间的时间窗口，正是业务踩雷的窗口。

## 四、为什么 docker 没事？containerd 和 docker 给 runc 的 payload 差异

这才是问题的关键差异点。

### 4.1 containerd 的 update payload

```json
{
  "devices": [{"allow": true, "access": "rwm"}],
  "memory": {"limit": 4294967296},
  "cpu": {"shares": 2048, "quota": 200000, "period": 100000, "cpus": "0-55"}
}
```

**包含 `devices` 字段**——即便只是一个空规则，runc 也会走到设备更新逻辑。

### 4.2 docker 的 update payload

```json
{
  "memory": {"limit": 0, "reservation": 0, "kernel": 0},
  "cpu": {"shares": 0, "quota": 0, "period": 0, "cpus": "0-63"},
  "blockIO": {"weight": 0}
}
```

**只有 `cpu` / `memory` / `blockIO`，完全没有 `devices`**——runc 没有理由触发设备规则更新。

源码上的差异：

**containerd CRI**（`pkg/cri/server/container_update_resources.go`）：

```go
func (c *criService) updateContainerResources(ctx context.Context, ...) (retErr error) {
    // 取当前 OCI spec，整体 update 后整体写回
    oldSpec, _ := cntr.Container.Spec(ctx)
    newSpec, _ := updateOCIResource(ctx, oldSpec, r, c.config)
    // ...
    if err := task.Update(ctx, containerd.WithResources(getResources(newSpec))); err != nil {
        return fmt.Errorf("failed to update resources: %w", err)
    }
}
```

containerd 把**整份 OCI Linux Resources** 传下去——包括 devices 列表。

**docker shim**（`pkg/kubelet/dockershim/docker_container.go`）：

```go
func (ds *dockerService) UpdateContainerResources(...) (*runtimeapi.UpdateContainerResourcesResponse, error) {
    resources := r.Linux
    updateConfig := dockercontainer.UpdateConfig{
        Resources: dockercontainer.Resources{
            CPUPeriod:  resources.CpuPeriod,
            CPUQuota:   resources.CpuQuota,
            CPUShares:  resources.CpuShares,
            Memory:     resources.MemoryLimitInBytes,
            CpusetCpus: resources.CpusetCpus,
            CpusetMems: resources.CpusetMems,
        },
    }
    // ...
}
```

docker 只挑 CRI Request 里的 CPU/Memory 字段——**根本没碰 devices**。

这就是为什么同一份 K8s 设置在两种运行时下行为完全不一样。

## 五、为什么 runc 会"刷新"整张设备列表？

### 5.1 systemd 的处理

`systemd` 收到 dbus 设置 `DeviceAllow` 时（`src/core/cgroup.c`），逻辑大概是：

```c
if (c->device_allow || policy != CGROUP_DEVICE_POLICY_AUTO)
    r = cg_set_attribute("devices", path, "devices.deny", "a");  // 先 deny all
else
    r = cg_set_attribute("devices", path, "devices.allow", "a");

// 然后遍历 device_allow，逐条 bpf_devices_allow_list_*
LIST_FOREACH(device_allow, a, c->device_allow) {
    // ...
    if (path_startswith(a->path, "/dev/"))
        r = bpf_devices_allow_list_device(prog, path, a->path, acc);
    else if ((val = startswith(a->path, "block-")))
        r = bpf_devices_allow_list_major(prog, path, val, 'b', acc);
    // ...
}
```

走通配符的情况下还会跑去解析 `/proc/devices`，把命中通配符的所有 major number 都写一遍：

```c
int bpf_devices_allow_list_major(...) {
    if (streq(name, "*"))
        return allow_list_device_pattern(prog, path, type, NULL, NULL, acc);

    // /proc/devices 里的每一行都拿来 fnmatch
    f = fopen("/proc/devices", "re");
    for (;;) {
        // ... 一行一行匹配，命中就调 allow_list_device_pattern
    }
}
```

**有多少个 major 命中通配符，就会写多少次。** 这就是为什么 containerd 节点的 `devices.list` 上有那么长一串 `c 1:* m`、`c 4:* m`、`c 5:* m`……每一行都是 systemd 展开通配符写进去的。

### 5.2 runc 的兜底

`runc` 调用 systemd 之前会构造 dbus 属性（`libcontainer/cgroups/systemd/v1.go`）：

```go
func genV1ResourcesProperties(r *configs.Resources, cm *dbusConnManager) ([]systemdDbus.Property, error) {
    deviceProperties, _ := generateDeviceProperties(r)
    properties = append(properties, deviceProperties...)
    // CPU/memory/cpuset 等等
}
```

但是 `addCpuset` 等函数都有"老 systemd 不支持就跳过"的判断：

```go
func addCpuset(...) error {
    sdVer := systemdVersion(cm)
    if sdVer < 244 {
        logrus.Debugf("systemd v%d is too old ...", sdVer)
        return nil
    }
}
```

我们集群上的 systemd 是 **v219**——CPU/Memory/Cpuset 这些都因为版本太老而被 runc 跳过，不会通过 dbus 设给 systemd。设备规则呢？设备规则倒是被传过去了。然后 runc 还会自己再用 cgroupfs 兜底写一遍：

```go
func (m *legacyManager) Set(r *configs.Resources) error {
    // 先调 systemd dbus
    setErr := setUnitProperties(m.dbus, unitName, properties...)

    // 然后 legacy subsystem 各自再用 cgroupfs 写一遍
    for _, sys := range legacySubsystems {
        path, _ := m.paths[sys.Name()]
        if err := sys.Set(path, r); err != nil {
            return err
        }
    }
}
```

也就是说 **systemd 写一次，runc 再用 cgroupfs 写一次**，更新设备规则的过程被走了不止一遍。

### 5.3 本该有的保护：freeze

runc 注释里写得清清楚楚：

```go
// We have to freeze the container while systemd sets the cgroup settings.
// The reason for this is that systemd's application of DeviceAllow rules
// is done disruptively, resulting in spurrious errors to common devices
// (unlike our fs driver, they will happily write deny-all rules to running
// containers). So we freeze the container to avoid them hitting the cgroup
// error. But if the freezer cgroup isn't supported, we just warn about it.
if err := m.Freeze(configs.Frozen); err != nil {
    logrus.Infof("freeze container before SetUnitProperties failed: %v", err)
}
```

**人家早就想到了。** 设计上的解法是：update 设备规则之前先把容器 freeze 住，等系统把 deny→allow 跑完，再 thaw 解冻。这样业务感知不到中间状态。

但是！抓线上 runc 日志：

```
... freeze container before SetUnitProperties failed: unable to freeze
```

freeze 失败了。看 freezer cgroup 的实现：

```go
func (s *FreezerGroup) Set(path string, r *configs.Resources) (Err error) {
    for i := 0; i < 1000; i++ {
        // ... 检查 state
        switch state {
            case "FREEZING":
                continue
        }
    }
    return errors.New("unable to freeze")
}
```

**1000 次重试（约 2s）都没冻结成功**，然后函数返回错误，但 runc 上层只打了个 `Infof` 日志，**继续往下走完整个 update 流程**。

为什么 freeze 不上？最可能的原因是这个业务进程数太多，或者存在不可中断 D 状态任务——freezer 等所有 task 都进入 FROZEN 才返回，只要有一个进不去就一直 FREEZING。

到这里整条链路就闭合了：

```
kubelet 定时同步资源
    │
    ▼
CRI: UpdateContainerResources（containerd 带上 devices 字段）
    │
    ▼
containerd → runc update
    │
    ├─► runc Freeze()
    │     └─► 重试 1000 次失败 → "unable to freeze"
    │     └─► 只打 Info 日志，继续往下走（!!）
    │
    ▼
runc → systemd dbus DeviceAllow
    │
    └─► systemd: 先 devices.deny=a，再回放整张 allow 列表
          │
          └─► 中间窗口（亚秒级）：所有设备权限都没了
                │
                └─► 业务 1ms 一次访问 /dev/urandom，必踩雷
                      └─► open returns EPERM → std::random_device 抛异常 → abort
```

## 六、几个验证实验

### 实验一：换 cgroup driver 为 cgroupfs

把 containerd 配 `SystemdCgroup=false`、kubelet `cgroup-driver=cgroupfs`。再跑测试程序，问题消失。

但是这个验证有个副作用：cgroupfs driver 下整个 device cgroup 的形态变了，devices.list 也短了。所以**单凭这一项还不能 100% 证明"deny+allow 间隙"是元凶**——还需要进一步排除。

### 实验二：在 runc 层把 devices 规则清空

写一个 hook 脚本把传给 runc 的 `devices` 字段强制清空：

```bash
#!/bin/bash
data=$(cat /dev/stdin)
if [[ $data ]]; then
    newdata=$(echo $data | jq '.devices=[]' -c)
    runc.original --debug --log /tmp/hook-runc.log $@ <<< "$newdata"
fi
```

把 `/bin/runc` 替换为这个 hook 脚本，再跑测试。**问题依然存在。** 也就是说 OCI 默认的 deny-all-then-allow-rwm 规则不是元凶。

### 实验三：在 runc 里加日志，看 dbus 实际属性

```go
logrus.Debugf("set cgroup properties => %v", properties)
```

观察 runc 实际给 systemd 的属性，**确认 runc 给 dbus 的 properties 里根本没有 device 相关字段**——也就是说 device 规则不是 runc 写到 dbus 的，而是 systemd 自己在收到任何 `Set` 调用时，看到当前 unit 上挂着 `DeviceAllow=`（由更早期 create 时设置），就会**整张重写一遍**。

这点和之前看的 systemd 代码对得上：systemd 不区分这次到底改了什么，只要 `DeviceAllow` 存在就 deny+allow 走一遍。

## 七、修复

### 7.1 业务侧

最直接的：把 `std::random_device` 的使用替换成一次性 seed 一个 PRNG。但这是侵入式的，对业务方不友好。

### 7.2 runc 侧

最优解是 runc 在 freeze 失败时**不要继续 update**。这个修复已经在上游社区合并：freeze 失败、且本次 update 涉及 device 规则时，直接报错返回，把决定权交回上层（containerd 可以重试、可以降级、可以告警），而不是悄悄给业务挖坑。

### 7.3 业务侧（间接）

让 freezer 能正常工作的前提是没有大量 D 状态进程。优化业务的不可中断 IO 调用、降低进程数，让 runc 的保护机制能生效。

## 八、几个让我印象深的点

**1. 同样的镜像在不同 runtime 上行为差异巨大**：从业务视角看根本不该关心 containerd 还是 docker，但当你深入到 cgroup driver / runc / systemd 这一层，差异是巨大的。docker 时代很多"隐性约定"在切到 containerd 之后被打破了。

**2. 看似无害的 freeze 失败**：runc 注释明明白白告诉你 freeze 是必要的、设备规则更新是 disruptive 的——但失败时只打了 Info 日志。从 SRE 视角看，这种"保护机制失败但继续执行"是非常危险的设计。修复方向应该是"保护失败必须中止 update"，而不是"打个日志继续干"。

**3. 老版本 systemd 是个雷区**：v219 在 cgroupv1 + runc 配合下有一堆细节问题（cpuset 不支持、device 规则全量重写、版本检测路径分支多）。生产环境如果不能升 systemd，就要意识到这一层潜在风险。

**4. 高频访问设备是"业务习惯"暴露出来的**：`std::random_device` 在大部分业务里不会成为问题，但广告检索这种每条请求都要新建对象的场景就成了"放大器"。**当你的代码访问频率 ms 级时，所有的瞬时不可用都会变成必现问题。**

**5. CRI 接口背后的"补丁责任"在谁那里**：containerd 把整份 Resources 透传是合理的——它不该假设上层只想改 CPU/Memory。但 runc 在 systemd cgroup driver 下做 device 更新的方式是不安全的。问题在 runc-systemd 链路上，但只有 containerd 用户能踩到。这种"两个组件都没错、合在一起就出事"的情况，是生产环境最难调的一类问题。

## 九、相关资料

- [runc: freeze container before SetUnitProperties](https://github.com/opencontainers/runc/blob/main/libcontainer/cgroups/systemd/v1.go) （含相关注释）
- [systemd cgroup.c](https://github.com/systemd/systemd/blob/main/src/core/cgroup.c)
- containerd CRI `UpdateContainerResources` 源码

---

*本文是一次生产 core 问题的复盘，时间为 2023-03。文中内部域名/节点名/镜像名已脱敏。*
