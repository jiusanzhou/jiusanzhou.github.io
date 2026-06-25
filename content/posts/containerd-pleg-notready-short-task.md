---
slug: containerd-pleg-notready-short-task
title: "短任务场景下 PLEG NotReady 排查：containerd 中一个被忽视的锁竞争"
date: 2023-10-23
published: true
tags: [Kubernetes, containerd, PLEG, NotReady, Kubelet, Overlayfs, Linux]
---

线上短任务资源池上的 Pod 频繁出现 Unknown、被驱逐杀掉的现象，节点不时抖一次 NotReady。这种问题最难受的地方在于：它已经被"解过一次"——之前我们用容器读写层切盘方案搞定过一批同样症状的 PLEG NotReady，但这次切盘对短任务场景几乎没效果。带着"为什么切盘不灵了"的疑问，我们重新挖了一遍，最后发现根因和切盘根本不在一条路径上：是 containerd 内 `Status` 锁被一个正在退出的容器卡死了 Kubelet 的 `ListContainers`。

<!--more-->

## 一、先说结论

### NotReady 的因果链

1. 容器退出时，shim server 会对 rootfs 执行 `umount2`，未启用 Volatile 挂载的 Overlay 在卸载时会触发磁盘 sync；
2. 节点 I/O 压力大或脏页多时，`umount2` 调用耗时显著变长（实测可达分钟级）；
3. Kubelet 每 10s 通过 CRI 调用 `UpdateContainerResources`，containerd 的实现里**先对容器 Status 加锁，再调用 Task Update**；
4. 此时 shim 因为还卡在 `umount2`，Task Update 一直得不到响应，直到超时才返回——Status 锁被一直握着；
5. 与此同时，Kubelet 的 PLEG 通过 `ListContainers` 拉容器状态，每个容器都要 `Status.Get()`；这个退出中的容器的 Status 锁被 Update 持有，`Get` 阻塞；
6. 一个容器卡住整个 `ListContainers` 返回，Kubelet relist 超时（> 3min），触发 `PLEG is not healthy`，节点进入 NotReady。

整个过程示意：

```
容器退出
  │
  ├─► shim 执行 umount2(rootfs)         ── Sync 慢，长时间不返回
  │
  ├─► Kubelet 调用 ContainerUpdateResource
  │     └─► 拿 Status.Lock
  │           └─► task.Update (RPC 到 shim)  ── 阻塞在 shim 端
  │
  └─► Kubelet 调用 ListContainers
        └─► 遍历容器 → Status.Get()        ── 等不到锁
              └─► 整个 List 超时
                    └─► PLEG NotReady
```

### 三条解决路径

对应三个原因，方案也是三条：

1. **给 overlayfs 增加 `volatile` 挂载参数**，卸载时不再触发 sync。要求 containerd ≥ 1.6.24（[containerd/containerd#8676](https://github.com/containerd/containerd/pull/8676)），内核 > 5.10（或我们后端打了补丁的 4.18）。已在线验证可行。
2. **正在退出的容器不再执行 Task Update**：从根本上让 Status 锁不被这种无意义的更新长时间持有。已编码验证，但有副作用（下面会展开）。
3. **进一步定位 shim server 为什么不能立即响应 RPC**：本质上是 shim 在 delete 流程中持有 process 锁，导致 update 拿不到锁——这条路偏底层修复，作为后续课题。

后文按"发现问题 → 加日志 → 复现 → 提交修复"的顺序展开。

## 二、问题背景

短任务资源池的负责同学反馈最近任务实例频繁异常：Unknown、被驱逐。从 Grafana 大盘看，节点 NotReady 的频次也确实在抬升。

之前在另一篇文章里（"10 台机器批量 PLEG NotReady"），我们针对一个 PLEG NotReady 场景提了 [containerd 容器读写层分盘方案](https://github.com/containerd/containerd/issues?q=overlay+split)，思路是把镜像层 IO 和 status 持久化 IO 分到不同盘上，避开 IO 互相干扰。这个方案在那个场景下效果显著。

但放到短任务资源池灰度了一段时间后，NotReady 并没有明显改善。这就引出了两个疑问：

- 切盘对当时的 PLEG NotReady 是不是只解决了表象？
- 短任务的 PLEG NotReady 是不是另一个根因？

回到出发点，当时之所以认为切盘能解，是基于"status 更新 IO 在系统盘"的假设——但**如果 status 更新本身已经不再有 IO 压力，容器退出时的 umount 是不是仍然会以另一种方式影响 ListContainers？** 这就是这次排查的起点。

## 三、问题分析

### 3.1 准备调试现场和量化指标

#### 3.1.1 选一个稳定复现的节点

短任务高优资源池单机复现概率很高，我们选了一台日常稳定出现 NotReady 的节点作为现场，定时备份对应时段的 Kubelet 日志和 xcapture 日志。

#### 3.1.2 PLEG 量化指标

之前我们只看节点 NotReady 总时长，没看 PLEG 本身耗时。这次先在内部的"单机问题诊断面板"里加了两个指标：

- `NotReady`：节点 NotReady 时间段；
- `PLEG Cost`：Kubelet relist 的 P99 耗时。

有意思的是，加完指标我们发现：

- 多个 PLEG NotReady 的时间段，PLEG 耗时指标本身是**缺失**的（采样 1 point / 15s）；
- 有数据的最高耗时是 145s，不到阈值 180s。

也就是说指标采集本身在节点抖动时也被影响了，这给后面的分析增加了难度。但至少我们有了"眼睛"，能粗略圈定问题时间段。

### 3.2 给 containerd 加打点

只看 Kubelet 侧的日志不够，必须深入 containerd CRI 插件的实现。Go 没有 strace 那种好用的工具，所以选最朴素的方式：改代码加日志，重新编译，灰度到调试节点。

#### 3.2.1 关键代码路径

##### ListContainers

`pkg/cri/server/container_list.go` 的逻辑非常简单：从 store 拿容器列表 → 遍历每个容器 `toCRIContainer`：

```go
func (c *criService) ListContainers(ctx context.Context, r *runtime.ListContainersRequest) (*runtime.ListContainersResponse, error) {
    containersInStore := c.containerStore.List()
    var containers []*runtime.Container
    for _, container := range containersInStore {
        containers = append(containers, toCRIContainer(container))
    }
    containers = c.filterCRIContainers(containers, r.GetFilter())
    return &runtime.ListContainersResponse{Containers: containers}, nil
}

func toCRIContainer(container containerstore.Container) *runtime.Container {
    status := container.Status.Get()
    return &runtime.Container{ /* ... */ }
}
```

可能耗时的两处：`containerStore.List()` 和 `Status.Get()`。

##### UpdateContainerResources

Kubelet 每 10s 通过 CRI 调用一次，更新容器资源：

```go
func (c *criService) UpdateContainerResources(ctx context.Context, r *runtime.UpdateContainerResourcesRequest) (*runtime.UpdateContainerResourcesResponse, error) {
    container, err := c.containerStore.Get(r.GetContainerId())
    if err != nil {
        return nil, fmt.Errorf("failed to find container: %w", err)
    }
    if err := container.Status.Update(func(status containerstore.Status) (containerstore.Status, error) {
        return status, c.updateContainerResources(ctx, container, r, status)
    }); err != nil {
        return nil, fmt.Errorf("failed to update resources: %w", err)
    }
    return &runtime.UpdateContainerResourcesResponse{}, nil
}
```

注意 `container.Status.Update`——它会**对 Status 加锁**，然后在闭包里调用 `updateContainerResources`。再看 `Update` 实现：

```go
func (s *statusStorage) Update(u UpdateFunc) error {
    s.Lock()
    defer s.Unlock()
    newStatus, err := u(s.status)
    if err != nil {
        return err
    }
    s.status = newStatus
    return nil
}
```

这把锁锁住的范围就是整个闭包执行期间。`updateContainerResources` 内部会调用 `task.Update`，这个调用要走 RPC 到 shim：

```go
if err := task.Update(ctx, containerd.WithResources(getResources(newSpec))); err != nil {
    if errdefs.IsNotFound(err) { return nil }
    return fmt.Errorf("failed to update resources: %w", err)
}
```

**`task.Update` 一旦阻塞，Status 锁就被一直持有，所有 `Status.Get()` 都得排队。** ListContainers 自然就跟着卡。

#### 3.2.2 加打点日志

针对几个关键路径分别加上耗时统计：

```go
// ListContainers: 总耗时 + 每个容器 Status.Get 耗时
func (c *criService) ListContainers(...) {
    start := time.Now()
    defer func() {
        logrus.Debugf("[ListContainers] all list containers cost %s", time.Now().Sub(start))
    }()
    // ...
}

func toCRIContainer(container containerstore.Container) *runtime.Container {
    start := time.Now()
    status := container.Status.Get()
    logrus.Debugf("[ListContainers] get container %s status cost %s", container.ID, time.Now().Sub(start))
    // ...
}

// UpdateContainerResources: 锁持有时长 + taskUpdate 耗时
func (c *criService) UpdateContainerResources(...) {
    // ...
    if err := container.Status.Update(func(status containerstore.Status) (containerstore.Status, error) {
        start := time.Now()
        defer func() {
            logrus.Debugf("[UpdateContainerResources] %s cost %s", r.GetContainerId(), time.Now().Sub(start))
        }()
        return status, c.updateContainerResources(ctx, container, r, status)
    }); err != nil {
        return nil, fmt.Errorf("failed to update resources: %w", err)
    }
    // ...
}

func (c *criService) updateContainerResources(...) {
    // ...
    start := time.Now()
    defer func() {
        logrus.Debugf("[updateContainerSpec.taskUpdate] %s cost %s", id, time.Now().Sub(start))
    }()
    if err := task.Update(ctx, containerd.WithResources(getResources(newSpec))); err != nil {
        // ...
    }
    return nil
}
```

编译、灰度、等 NotReady 复现。

### 3.3 现场日志：终于看到罪魁

等了几天，节点上又出了一次 NotReady。捞日志：

```
T09:30:11.885 level=debug msg="failed to delete task" error="context deadline exceeded" id=40585f73...
T09:30:11.885 level=error msg="failed to handle container TaskExit event ... ID:40585f73 ...
                                ExitedAt:2023-11-08 01:30:01 ..." error="failed to delete task: context deadline exceeded"
T09:30:21.510 level=error msg="get state for 40585f73..." error="context deadline exceeded"
T09:33:43.226 level=debug msg="[updateContainerSpec.taskUpdate] 40585f73... cost 1m57.542685352s"
T09:33:43.499 level=debug msg="[UpdateContainerResources] 40585f73... cost 2m0.271565471s"
T09:33:43.499 level=error msg="UpdateContainerResources for \"40585f73...\" failed" error="context canceled"
T09:33:43.499 level=debug msg="[ListContainers] get container 40585f73... status cost 1m28.992474091s"
```

把数字拎出来：

| 阶段 | 耗时 |
|---|---|
| `ListContainers.Get` | 1m29s |
| `GetContainerStatus` | 1m28s |
| `updateContainerResources` | 2m0s |
| `updateContainerSpec.taskUpdate` | **1m57s** |
| 其余逻辑 | ~3s |

结论非常清楚：**`taskUpdate` 吃掉了 `updateContainerResources` 几乎全部耗时**，由于 Status 锁的存在，整个 `ListContainers` 跟着被拖到 1 分多钟。

### 3.4 主动复现

确认推断要靠复现。

#### 3.4.1 测试 Pod

需要保证两点：

- `restartPolicy: Never` —— 这样容器退出后会触发 Task 删除（即 sandbox 卸载）；
- 直接 `nodeName` 钉到调试节点。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: debug-for-cntr
spec:
  restartPolicy: Never
  nodeName: debug-node
  containers:
  - name: container1
    image: internal-registry/base/loop:latest
    command: ['sh', '-c', 'while true; do date; sleep 1; done']
```

启动后取几个关键 ID：

```bash
CNTR_PID=$(ps -ef | grep 'while true' | grep -v grep | awk '{print $2}')
SHIM_PID=$(ps -ef | grep 'while true' | grep -v grep | awk '{print $3}')
SANDBOX_ID=$(cat /proc/$SHIM_PID/cmdline | tr '\0' ' ' | awk '{print $5}')
```

#### 3.4.2 模拟 umount2 卡顿

IO 压力本质上是让 `umount2` 系统调用回不来。用 `strace` 直接给 shim 进程的 `umount2` 注入 60s 延时（strace ≥ v4.22）：

```bash
strace -p $SHIM_PID -e trace=umount2 -f -e inject=umount2:delay_enter=60000000 -b execve
```

#### 3.4.3 触发容器退出

```bash
kill -9 $CNTR_PID
```

观察 strace 终端：

```
[pid 843099] --- SIGCHLD ... ---
[pid 843100] umount2("/run/containerd/io.containerd.runtime.v2.task/k8s.io/2346f52c.../rootfs", 0 <unfinished ...>
... 等待 60s ...
[pid 843100] <... umount2 resumed>)     = 0
```

注入成功，`umount2` 被卡住。值得一提的是这里 shim 并**没有正常退出**——这是 containerd 1.6 上一个 shim 泄漏问题的痕迹，不在本文展开。

containerd 日志：

```
T17:34:41 [updateContainerSpec] 771d1a... cost 63.682694ms
T17:34:43 level=error msg="get state for 771d1a..." error="context deadline exceeded"
T17:34:50 level=debug msg="failed to delete task" error="context deadline exceeded" id=771d1a...
T17:36:40 [updateContainerSpec.taskUpdate] 771d1a... cost 1m56.983028134s
T17:36:40 [UpdateContainerResources] 771d1a... cost 1m59.106818442s
T17:36:40 [ListContainers] get container 771d1a... status cost 1m58.185192038s
T17:36:40 level=error msg="UpdateContainerResources for \"771d1a...\" failed" \
          error="failed to update resources: cannot update a deleted process"
T17:36:40 [ListContainers] get container 771d1a... status cost 1m2.269374691s
T17:36:40 [ListContainers] get container 771d1a... status cost 1m55.208983726s
T17:36:40 [ListContainers] get container 771d1a... status cost 1m57.267298304s
...
T17:36:40 handleContainerExit status.updateSync 771d1a... cost 1m50.40571539s
```

完整复现：

- 多个并发的 `ListContainers` 全部卡在同一个容器上，最长 1m58s（umount 延时是 1min，但实际等待略长是因为 RPC 自身的超时窗口和 retry）；
- `UpdateContainerResources` 1m59s；
- `updateContainerSpec.taskUpdate` 1m56s。

到这里因果链全部闭环。

### 3.5 关键问题：为什么 task.Update 会被 block？

shim v2 server 启动在 `runtime/v2/shim/shim.go`：

```go
func run(...) error {
    server, err := newServer()
    // 注册 TaskService
    for _, srv := range ttrpcServices {
        if err := srv.RegisterTTRPC(server); err != nil {
            return fmt.Errorf("failed to register service: %w", err)
        }
    }
    // serve 一直 block 在这里响应请求
    if err := serve(ctx, server, signals, sd.Shutdown); err != nil {
        if err != shutdown.ErrShutdown { return err }
    }
    // 注意：如果 shim 异常退出，address socket 可能会泄漏
    if address, err := ReadAddress("address"); err == nil {
        _ = RemoveSocket(address)
    }
}
```

TaskService 的实现在 `runtime/v2/runc/service.go`，进一步追踪 `Update` 调用：

```go
func (s *service) Update(ctx context.Context, r *taskAPI.UpdateTaskRequest) (*ptypes.Empty, error) {
    container, err := s.getContainer()
    if err != nil { return nil, err }
    if err := container.Update(ctx, r); err != nil {
        return nil, errdefs.ToGRPC(err)
    }
    return empty, nil
}
```

继续往下追 `process/init.go` 的 delete 逻辑，会发现 delete 流程持有了 process 锁，导致 Update 拿不到锁——这就是 shim 端不能立即响应的原因。具体细节作为后续课题。

## 四、解决方案

根据三条路径，我们至少可以从两个层面修：

1. **overlayfs volatile 挂载**：卸载时不 sync，从源头消除耗时。要求 containerd ≥ 1.6.24 + 内核 > 5.10 / 后端打补丁的 4.18。
2. **CRI 层：正在退出的容器不再执行 task.Update**：从 containerd 内部避免无意义的状态更新阻塞 Status 锁。

第一条是基础设施层面的改造，需要分批灰度且依赖内核版本；第二条改动小、收益直接，我们优先验证。

### 4.1 方案 2：标记退出态，跳过 task.Update

思路非常直接：当 containerd 收到 `TaskExit` 事件时，把容器状态标为 `Stopping`，后续 `UpdateContainerResources` 看到 `Stopping = true` 直接返回。这样既不会再触发对一个已退出容器的无意义 RPC，也不会再长时间持有 Status 锁。

代码改动：

```diff
diff --git a/pkg/cri/server/container_update_resources.go b/pkg/cri/server/container_update_resources.go
@@ -81,9 +81,9 @@ func (c *criService) updateContainerResources(ctx context.Context,
        newStatus = status
        id := cntr.ID
-       // Do not update the container when there is a removal in progress.
-       if status.Removing {
-               return newStatus, fmt.Errorf("container %q is in removing state", id)
+       // Do not update the container when there is a removal or stop in progress.
+       if status.Removing || status.Stopping {
+               return newStatus, fmt.Errorf("container %q is in removing or stopping state", id)
        }

diff --git a/pkg/cri/server/events.go b/pkg/cri/server/events.go
@@ -377,6 +377,13 @@ func (em *eventMonitor) handleEvent(any interface{}) error {

 // handleContainerExit handles TaskExit event for container.
 func handleContainerExit(ctx context.Context, e *eventtypes.TaskExit, cntr containerstore.Container, sandboxID string, c *criService) error {
+       // First we need to update the status of container to a Stopping state
+       // to avoid container updating from UpdateContainerResources
+       _ = cntr.Status.Update(func(status containerstore.Status) (containerstore.Status, error) {
+               status.Stopping = true
+               return status, nil
+       })
+
        // Attach container IO so that `Delete` could cleanup the stream properly.
        // ...

@@ -457,6 +464,9 @@ func handleContainerExit(ctx context.Context, e *eventtypes.TaskExit, cntr conta
                        status.ExitCode = int32(e.ExitStatus)
                }

+               // Reset the stopping state
+               status.Stopping = false
+

diff --git a/pkg/cri/store/container/status.go b/pkg/cri/store/container/status.go
@@ -90,6 +90,8 @@ type Status struct {
        Starting bool `json:"-"`
+       // Stopping indicates that the container is in stopping state.
+       Stopping bool `json:"-"`
        Removing bool `json:"-"`
```

编译、灰度，复现 umount2 卡顿场景，**`Status.Get` 耗时不再有秒级毛刺**。从指标上看 PLEG 耗时也回到正常水位。

### 4.2 副作用：Pod 被 Kubelet 误判重建

灰度测试中观察到一个意外现象：部分任务 Pod 被 Kubelet 重建了。

```
10:00:14 Receiving a new pod ...
10:00:16 Creating container 84376ad6ce3
10:00:16 PLEG ContainerStarted -> Running
...
11:45:36 computePodActions ContainersToKill{84376ad6ce3}
11:45:36 Killing unwanted container 84376ad6ce3
11:45:42 SyncLoop (PLEG) ContainerDied 84376ad6ce3
11:45:49 Status for pod ... {Phase:Pending} ContainerStatuses{Waiting}
11:47:02 Creating container 730f6e6451a
```

业务侧反馈，这个任务的实际运行起止时间是 `10:00:13` → `11:45:25`——也就是说 Kubelet 在容器**自然结束之后**触发了一次重建。看 Kubelet `kuberuntime_manager.go`：

```go
if containerStatus == nil || containerStatus.State != kubecontainer.ContainerStateRunning {
    if kubecontainer.ShouldContainerBeRestarted(&container, pod, podStatus) {
        changes.ContainersToStart = append(changes.ContainersToStart, idx)
        if containerStatus != nil && containerStatus.State == kubecontainer.ContainerStateUnknown {
            // If container is in unknown state, we don't know whether it
            // is actually running or not, always try killing it before
            // restart to avoid having 2 running instances of the same container.
            changes.ContainersToKill[containerStatus.ID] = containerToKillInfo{
                // ...
            }
        }
    }
    continue
}
```

可以推测：当我们让 containerd 对一个 `Stopping` 容器直接返回错误时，某些路径下容器的状态在 Kubelet 视角变成了 `Unknown`，触发了它的"宁可错杀不可放过"逻辑。

这条副作用需要进一步收敛，例如在 `Stopping` 期间对 `Status.Get` 返回的状态做更细的标记，避免 Kubelet 进入重建分支。这个修复正在和社区讨论中。

## 五、总结与反思

这次排查跑下来，几个让我印象比较深的点：

**1. 指标先行**：定位前先把"PLEG 耗时"这个指标采上来，是后面所有分析的前提。系统抖动的诊断，必须有量化的"眼睛"。

**2. 不要被既有方案误导**：之前的"切盘"在另一个场景里有效，并不意味着对所有"PLEG NotReady"都有效。切盘解的是 Status 更新 IO 的问题；这次的根因是 Status 锁被退出容器的 task.Update 卡住，二者完全不在一条路径上——只是**症状相似**。

**3. 锁的"持有时长" vs "拿锁开销"**：Go 代码里的锁本身很轻，但锁持有期间执行的 RPC 阻塞了几分钟，就把整个进程的并发能力打死了。`Status.Update` 这种"在锁内调远端 RPC"的写法在并发量低、远端稳定时不会暴露，但一旦远端不可用就是雷区。

**4. Containerd 自身的脆弱性**：shim 在 delete 流程持有 process 锁，导致 task.Update 拿不到锁；shim 在 umount 异常时 socket 不能回收造成 shim 泄漏——这些都是同源问题（异常路径下资源没有及时释放）的不同表现。

**5. 解一个问题、产生一个新问题**：CRI 侧的修复让 PLEG 恢复了，但 Kubelet 的 Unknown 重建副作用也跟着冒出来。任何在底层动状态机的改动，都需要把上层的容错路径走一遍——很多时候副作用比主作用更难调。

## 六、相关链接

- [containerd: add `volatile` mount option for overlayfs](https://github.com/containerd/containerd/pull/8676)
- containerd shim leaks（v1.6 系列已知问题）
- Kubelet PLEG 健康检查机制（`pkg/kubelet/pleg/generic.go`）

---

*本文是一次稳定性排查的完整复盘，时间为 2023-10 至 2023-11。文中部分内部链接和具体节点名已脱敏处理。*
