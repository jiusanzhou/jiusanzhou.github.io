---
slug: containerd-init-container-stuck-running
title: "containerd init 容器卡在 Running：rootfs umount 超时引发的状态机错位"
date: 2023-12-28
published: true
tags: [Kubernetes, containerd, CRI, Overlayfs, Linux, runc]
---

线上一台 staging 节点上的 init-proxy 容器明明已经退出了十几分钟，CRI 视角下仍然是 Running——后面的业务容器全都在等它，整个 Pod 卡死在初始化。这次的坑跟之前那篇 [短任务 PLEG NotReady 排查](/blog/containerd-pleg-notready-short-task/) 是同一片树林（都是 `umount2` 慢 + CRI 状态机），但翻车姿势完全不一样。

<!--more-->

## 一、先说结论

### 现象
init-proxy 容器实际已经在 14:25 退出，但 CRI 直到 14:40 才看到 Exited 状态，**整整迟了 15 分钟**。这期间业务容器在等 init 完成，整个 Pod 卡死。

### 根因
容器的 `task` 退出时，containerd CRI 插件在 `handleContainerExit` 里**先调 `task.Delete` 再更新 Status**：

```
TaskExit 事件
  ├─► task.Delete(...)           ← shim 在这里执行 umount2(rootfs)
  │     ↑ IO 压力下 umount2 超时
  │     └─► RPC 返回 "context deadline exceeded"
  │
  └─► 返回 error 直接退出，根本没机会执行下面这段：
        cntr.Status.UpdateSync(... Running → Exited ...)
```

也就是说：**`task.Delete` 失败的副作用是 Status 永远停留在 Running**。Kubelet 看到的就是一个"已经死了但还没死"的僵尸容器。

### 解决路径

1. **治标**：解决节点 IO 压力，给 rootfs 换 SSD，或者用 overlayfs `volatile` 挂载避免 umount sync；
2. **治本**：调整 CRI 容器状态变更顺序——先把 Status 落到 Exited，再去等 rootfs 卸载，但这有 shim 泄漏风险，需要更仔细的设计；
3. **临时方案**：把 `task.Delete` 失败时的错误处理改成"继续更新 Status"，业内 containerd 社区已有相关讨论。

下面按"打点 → 复现 → 定位"的顺序展开。

## 二、问题背景

某天早晨 staging 集群一台节点的 init-proxy 容器明显跑了很久才退出，但用户实例还卡在初始化。运维同学拉了 crictl 输出过来，肉眼可见：业务容器在等 init-proxy，但 init-proxy 在 CRI 视角下仍然是 Running，时间戳显示已经 startedAt 了十几分钟。

进节点看 containerd 的 status 文件（`/media/disk1/containerd/io.containerd.grpc.v1.cri/containers/<cid>/status`）：

```bash
File: 'status'
Size: 159     Blocks: 8    IO Block: 4096
Access: 2023-12-28 14:40:23.234325965 +0800
Modify: 2023-12-28 14:40:23.234325965 +0800
Change: 2023-12-28 14:40:23.950324617 +0800
```

```json
{
  "status": {
    "state": "CONTAINER_EXITED",
    "createdAt": "2023-12-28T14:25:00.479913972+08:00",
    "startedAt": "2023-12-28T14:25:01.79191972+08:00",
    "finishedAt": "2023-12-28T14:25:02.271226053+08:00",
    "exitCode": 0,
    "reason": "Completed"
  }
}
```

关键对比：

- `finishedAt`（task 实际退出时间）：**14:25:02**
- `status` 文件的写入时间（CRI 视角发现退出）：**14:40:23**

中间整整差了 **15 分钟**。Kubelet PLEG 这段时间一直拿不到这个容器的 Exited 状态，Pod 的下一步推进就全都卡住了。

## 三、问题分析

### 3.1 先看 CRI 处理退出事件的代码

containerd 处理容器退出事件的入口在 `pkg/cri/server/event.go` 的 `handleContainerExit`，简化后的流程是：

```go
func handleContainerExit(ctx context.Context, e *eventtypes.TaskExit, cntr containerstore.Container) error {
    // 1) 标记容器为 Stopping（避免和 update_resource 撞锁，这是 PLEG NotReady 那次的修复）
    _ = cntr.Status.Update(func(status containerstore.Status) (containerstore.Status, error) {
        status.Stopping = true
        return status, nil
    })

    // 2) 拿到 task
    task, err := cntr.Container.Task(ctx, ...)
    if err != nil {
        if !errdefs.IsNotFound(err) {
            return fmt.Errorf("failed to load task for container: %w", err)
        }
    } else {
        // 3) 调用 task.Delete —— 内部会做 shim Delete + rootfs umount
        if _, err = task.Delete(ctx, WithNRISandboxDelete(cntr.SandboxID), containerd.WithProcessKill); err != nil {
            if !errdefs.IsNotFound(err) {
                return fmt.Errorf("failed to stop container: %w", err)
                // ↑ 注意：这里直接 return，下面不会执行
            }
        }
    }

    // 4) 更新 Status：Running → Exited
    err = cntr.Status.UpdateSync(func(status containerstore.Status) (containerstore.Status, error) {
        if status.FinishedAt == 0 {
            status.Pid = 0
            status.FinishedAt = e.ExitedAt.UnixNano()
            status.ExitCode = int32(e.ExitStatus)
        }
        if status.Unknown {
            status.Unknown = false
        }
        return status, nil
    })
    ...
}
```

到这里其实根因已经能猜到了：**第 3 步失败的话，第 4 步根本不会执行**。但要确认是不是真的卡在第 3 步，得加打点。

### 3.2 沿着 task.Delete 一路加打点

我把日志加在了几条关键路径上，方便对账 RPC 哪一段慢：

```go
// task.go：从 client 视角看 task.Delete
st := time.Now()
r, err := t.client.TaskService().Delete(ctx, &tasks.DeleteTaskRequest{
    ContainerID: t.id,
})
logrus.Debugf("[zoe] task delete call task service delete coast %+v", time.Now().Sub(st))
```

```go
// runtime/v2/manager.go：TaskManager 视角
func (m *TaskManager) Delete(ctx context.Context, taskID string) (*runtime.Exit, error) {
    st := time.Now()
    item, err := m.manager.shims.Get(ctx, taskID)
    log.G(ctx).Infof("[zoe] taskmanager delete get shim coast %v", time.Now().Sub(st))
    ...
    st = time.Now()
    exit, err := shimTask.delete(ctx, func(ctx context.Context, id string) {
        m.manager.shims.Delete(ctx, id)
    })
    log.G(ctx).Infof("[zoe] taskmanager delete shim task coast %v", time.Now().Sub(st))
    ...
}
```

```go
// runtime/v2/runc/container.go：shim 侧的 Container.Delete
func (c *Container) Delete(ctx context.Context, r *task.DeleteRequest) (process.Process, error) {
    st := time.Now()
    p, err := c.Process(r.ExecID)
    logrus.Infof("[zoe] runc delete container get process %s", time.Now().Sub(st))
    ...
    st = time.Now()
    if err := p.Delete(ctx); err != nil {
        logrus.Infof("[zoe] runc delete container delete process %s", time.Now().Sub(st))
        return nil, err
    }
    logrus.Infof("[zoe] runc delete container delete process %s", time.Now().Sub(st))
    ...
}
```

```go
// pkg/process/init.go：Init.delete，真正去调 runc + umount 的地方
func (p *Init) delete(ctx context.Context) error {
    waitTimeout(ctx, &p.wg, 2*time.Second)
    st := time.Now()
    err := p.runtime.Delete(ctx, p.id, nil)
    log.G(ctx).Info("[zoe] Init delete/runtime.Delete coast", time.Now().Sub(st))
    ...
    st = time.Now()
    defer func() {
        log.G(ctx).Info("[zoe] Init delete/UnmountAll coast", time.Now().Sub(st))
    }()
    if err2 := mount.UnmountAll(p.Rootfs, 0); err2 != nil {
        log.G(ctx).WithError(err2).Warn("failed to cleanup rootfs mount")
        ...
    }
    return err
}
```

打点的目标很明确：把"client → manager → shim → init.delete → UnmountAll"这条链路每一跳的耗时都打出来，定位卡点。

### 3.3 注入延时复现

正常环境下偶发慢，我用 strace 的 inject 在 `umount2` 上人为注入延时来稳定复现。这招对调试这种 IO 慢导致的问题特别管用：

```bash
# 拿到 shim 的 PID
SHIM_PID=$(ps -ef | grep $(sudo crictl pods | grep node-problem | grep -w Ready | awk '{print $1}') | grep -v grep | awk '{print $2}')

# 给这个 shim 的 umount2 注入 60 秒延时（strace >= 4.22）
sudo strace -e trace=umount2 -f -e inject=umount2:delay_enter=60000000 -b execve -p $SHIM_PID
```

然后另开终端 `journalctl -u containerd -f` 抓 `[zoe]` 打点，最后杀掉容器内的业务进程触发退出：

```bash
sudo ps -ef | grep node-problem-detector | grep -v grep | awk '{print $2}' | xargs sudo kill
```

### 3.4 把账对上

抓到的日志（节选）：

```
level=debug msg="received exit event &TaskExit{ContainerID:1d586e..., ExitedAt:2023-12-28 13:18:49.167031554, ...}"
level=info  msg="[zoe] taskmanager delete shim task coast 9.991741935s"
level=debug msg="[zoe] task delete call task service delete coast 9.991791137s"
level=debug msg="failed to delete task" error="context deadline exceeded"
level=debug msg="[zoe] OnTeskExits delete task failed coast 10.000087609s"
```

```
level=info msg="[zoe] runc delete container delete process 20.029129999s"
```

读这段日志可以重建出整个故事：

1. **13:18:49** 收到 TaskExit 事件，进入 `handleContainerExit`；
2. CRI 调用 `task.Delete`，发往 shim 的 ttrpc Delete；
3. shim 在 `Container.Delete → Init.delete → UnmountAll(rootfs)` 这段卡了 **20 秒**（被注入的延时）；
4. 但 CRI 这一侧的 ctx 默认就 **10 秒超时**，所以 client 这边在 10s 时就拿到 `context deadline exceeded`；
5. `task.Delete` 返回 error，`handleContainerExit` 直接 `return fmt.Errorf(...)`；
6. **`Status.UpdateSync` 那段代码根本没机会运行**，容器 status 文件还是 Running；
7. 直到下次 Kubelet 或 containerd 内部某个补偿机制再触发，status 才被回填——日志里看到这个补偿是 15 分钟后才走到。

这就是为什么 task 实际 14:25 退出，CRI 视角 14:40 才看到 Exited。

### 3.5 为什么 umount2 这么慢

回到 shim 卡 20 秒的根因：rootfs 是 overlayfs，upper 层在主数据盘上。**overlayfs 在 `umount` 时会对 upper 所在的 fs 整体做一次 sync**——节点 IO 压力大或者脏页多时，这次 sync 就是分钟级。

这其实跟 [短任务 PLEG NotReady 排查](/blog/containerd-pleg-notready-short-task/) 那次踩到的是同一个 overlayfs sync 问题，只不过表现完全不一样：

- 那次：`umount2` 慢 → shim 不响应 → CRI Status 锁拿不到 → ListContainers 阻塞 → PLEG NotReady；
- 这次：`umount2` 慢 → `task.Delete` 超时 → CRI 状态机直接 short-circuit → 容器卡在 Running。

同一个底层 IO 慢，可以让上层翻车出两种完全不同的故障模式。

## 四、解决思路

这次的核心结论其实很简单：

> **`task.Delete` 失败时，CRI 不应该跳过 Status 更新。**

但要解决得分两层。

### 4.1 治标：减轻 umount2 的 IO 压力

最直接的几条路：

1. **换 SSD** 提升 IO 上限——属于运维层动作；
2. **overlayfs `volatile` 挂载**：containerd ≥ 1.6.24 已支持，volatile 挂载下 umount 不做 sync。要求内核 >= 5.10（或后端打补丁的 4.18）；
3. **限制单机容器密度**和短任务并发数，避免节点 IO 长时间打满。

### 4.2 治本：调整 CRI 的状态变更顺序

设想中的修复是：**先把 CRI Status 由 Running 改成 Exited，再去等 rootfs 卸载**。这样即使 umount 慢甚至失败，Kubelet 视角下的容器状态也是正确的。

但这会带来两个新问题：

1. **shim 泄漏风险**：如果 Status 先标为 Exited，后续 umount 失败的容器，shim 进程谁来清？需要补一套独立的清理逻辑；
2. **和社区设计不一致**：当前 containerd 上游就是"先 Delete 再 Update"的顺序，改顺序需要在社区单独立 issue 讨论，否则维护代价高。

### 4.3 临时兜底：失败时也写 Status

更轻量的兜底是：`task.Delete` 失败但**确实拿到了 TaskExit 事件**的情况下，至少应该把 Status 的 FinishedAt/ExitCode 写进去——shim 留着以后清理，至少先让 Kubelet 视角的状态正确。这是个相对小但很实用的改动。

## 五、附录

- diff 完整内容（打点版本，仅供调试参考）：

```diff
diff --git a/pkg/cri/server/events.go b/pkg/cri/server/events.go
@@ -384,11 +384,14 @@ func handleContainerExit(ctx context.Context, e *eventtypes.TaskExit, cntr conta
        }
    } else {
        // TODO(random-liu): [P1] This may block the loop, we may want to spawn a worker
+       st := time.Now()
        if _, err = task.Delete(ctx, WithNRISandboxDelete(cntr.SandboxID), containerd.WithProcessKill); err != nil {
            if !errdefs.IsNotFound(err) {
+               logrus.Debugf("[zoe] OnTeskExits delete task failed coast %+v", time.Now().Sub(st))
                return fmt.Errorf("failed to stop container: %w", err)
            }
+           logrus.Debugf("[zoe] OnTeskExits delete task success coast %+v", time.Now().Sub(st))
        }
    }

diff --git a/pkg/process/init.go b/pkg/process/init.go
@@ -290,7 +292,9 @@ func (p *Init) Delete(ctx context.Context) error {
 func (p *Init) delete(ctx context.Context) error {
    waitTimeout(ctx, &p.wg, 2*time.Second)
+   st := time.Now()
    err := p.runtime.Delete(ctx, p.id, nil)
+   log.G(ctx).Info("[zoe] Init delete/runtime.Delete coast", time.Now().Sub(st))
    ...
+   st = time.Now()
+   defer func() {
+       log.G(ctx).Info("[zoe] Init delete/UnmountAll coast", time.Now().Sub(st))
+   }()
    if err2 := mount.UnmountAll(p.Rootfs, 0); err2 != nil {
```

- strace 注入 umount2 延时复现命令：

```bash
sudo strace -e trace=umount2 \
    -f -e inject=umount2:delay_enter=60000000 \
    -b execve -p $SHIM_PID
```

- 相关阅读：[短任务场景下 PLEG NotReady 排查](/blog/containerd-pleg-notready-short-task/)（同一类 umount/IO 问题的另一种翻车姿势）
