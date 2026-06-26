---
slug: containerd-high-cpu-gogc-tuning
title: "containerd 跑满一核 CPU：GOGC 默认值在大节点上是个坑"
date: 2024-01-15
published: true
tags: [containerd, Golang, GC, GOGC, perf, Performance]
---

线上几台 C19 大机型上 containerd 持续占满一核 CPU，业务方反馈节点抖动。`perf` 一抓火焰图，根因清晰得令人尴尬：99% CPU 在 Go GC 上。调一个环境变量就完事——但事后整理才发现，**Go 默认 GOGC=100 在长生命周期、低存活堆的进程上几乎是个反模式**。

<!--more-->

## 一、先说结论

- **根因**：containerd 的 live heap 很小（几百 MB），但短期内分配速率高，默认 GOGC=100 让 GC 频繁触发，CPU 消耗几乎全打在 GC 上；
- **解法**：`GOGC=1000`，放宽 GC 触发阈值。代价是常驻内存从 ~700M 涨到约 1G 左右（可接受），containerd CPU 从 ~1 核掉到 0.4 核。

## 二、问题现场

线上两台 C19 机型反馈 containerd CPU 占用异常：

- 节点：业务大机型，单节点上跑几十个 Pod
- 现象：containerd 进程长期占满一核 CPU
- 内存：containerd RSS 只有 ~700 MB（按 containerd 体量这是正常水位）

**关键反差**：CPU 几乎被打满，但内存非常低——这种"CPU 高、内存低"的反差是 Go 程序里 GC 抖动的典型信号。

## 三、问题分析

### 3.1 抓热点

直接 `perf` 看 CPU 都花在哪：

```bash
perf -p `pidof containerd` -g -- sleep 20
```

火焰图里 99% 的栈都指向 `runtime.gcBgMarkWorker` / `runtime.scanobject` / `runtime.greyobject` 这些 Go 运行时的 GC 函数。结合内存只有 700M 的现状，可以直接定位到：**频繁 GC**。

### 3.2 去验证

为了确认假设，先把 GC 完全关掉：

```bash
GOGC=off
```

效果：

- 内存：开始持续上涨，跑了一会儿到 16 GB（关 GC 当然会无限增长）；
- CPU：掉到 **0.2 核** 左右。

这就锁死了——CPU 高确实是 GC 引起的。但 GOGC=off 显然不能用，要找一个合理的中间值。

最后调到 `GOGC=1000`：

- 内存：~700 MB（基本和原来持平，因为 live heap 本身就小）；
- CPU：~0.4 核；
- Pod 创建/销毁等 containerd 主链路功能验证：无异常。

### 3.3 看原理

为什么调大 GOGC 一下子从 1 核掉到 0.4 核？

Go 的 GC 触发条件由 GOGC 控制，公式是：

> Target heap memory = Live heap + (Live heap + GC roots) × GOGC / 100

GOGC 的含义是：**新增堆相对于活跃堆的百分比**，达到这个比例就触发下一次 GC。默认 GOGC=100 意味着：

- live heap = 10 MB，下次 GC 在 heap 涨到 20 MB 时触发；
- live heap = 700 MB，下次 GC 在 heap 涨到 1.4 GB 时触发。

但 containerd 这种"长生命周期 + 短临时对象多"的进程有个特点：

- live heap 长期稳定在几百 MB；
- 但短时间内可以分配大量临时对象（每次容器创建/销毁/状态查询都会产生一堆中间对象）；
- 临时对象的"新增量"很容易达到 live heap 的 100%，于是 GC 就被频繁触发——但每次 GC 真正要清的对象其实没几个；
- 结果就是 GC 反复跑，每次都做无用功，CPU 全砸 GC 上。

调大 GOGC 等于"放宽 GC 触发阈值"：让那些短期临时对象有机会自然消亡，再来一波 GC 一起清掉，**单位 CPU 清理的垃圾量上去了，GC 频次下来了**。代价是峰值内存高一些。

更详细的解释参考 [Go GC Guide](https://tip.golang.org/doc/gc-guide#GOGC)。

## 四、解决思路

落地非常简单，编辑 `containerd.service`：

```ini
/usr/lib/systemd/system/containerd.service

[Service]
ExecStartPre=-/sbin/modprobe overlay
ExecStart=/usr/bin/containerd
Environment="GOGC=1000"
```

`systemctl daemon-reload && systemctl restart containerd`，整机生效。

### GOGC 值的选择

我们最终选了 1000，但这个值不是金科玉律：

- **GOGC=200~500**：折中。内存涨幅不大，CPU 也能明显下降；
- **GOGC=1000**：我们的选择。containerd live heap 几百 MB，1000% 的余量意味着峰值堆 ~1G，可接受；
- **GOGC=off**：内存无限涨，**只用于调试**；
- **更精细**：用 `GOMEMLIMIT` 设置软上限，让 Go 在接近上限时主动 GC——比 GOGC 单独使用更稳，但需要更精确的 sizing。

判断方法：看 live heap 大小 + 对内存的容忍度。**live heap 越小、容忍内存越多，GOGC 可以越大**。

## 五、附录

- 启用前后对比（实测）：

| 指标 | GOGC=100（默认） | GOGC=off | GOGC=1000 |
|------|------------------|----------|-----------|
| CPU | ~1 核 | ~0.2 核 | ~0.4 核 |
| RSS | ~700 MB | 持续上涨到 16 GB | ~700 MB（峰值约 1 GB） |
| GC 频次 | 高 | 0 | 低 |

- 参考：
  - [Go GC Guide - GOGC](https://tip.golang.org/doc/gc-guide#GOGC)
  - [Go GC Guide - GOMEMLIMIT](https://tip.golang.org/doc/gc-guide#GOMEMLIMIT)
