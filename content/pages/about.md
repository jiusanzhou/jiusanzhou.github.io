---
title: 关于我
slug: about
lang: zh-CN
---

# 关于我

我是 Zoe，AI Infra Engineer，坐标杭州。

写代码 10 年。Go / Python / Flutter / Rust 都写。前半段做分布式系统、容器调度、GPU 集群；这两年全栈转向 AI 推理，目前在一家大型互联网公司负责自研推理服务平台。

## 现在的主线

**AI Infra**：每天跟 LLM、vLLM、SGLang、GPU 打交道。

负责的事情围绕几个关键词：

- **LLM Serving**：大模型推理服务化、PD 分离、KV Cache 传输、长上下文优化
- **GPU 集群**：多卡 TP / 多机 PP、NCCL/RDMA 网络、GPU 拓扑亲和
- **推理加速**：vLLM / SGLang / TensorRT-LLM 部署调优、量化、Continuous Batching
- **平台化**：把推理能力变成稳定可调度的服务，给业务方用得稳、用得省

业余时间在做 **AI Ops 工具**——把日常的 AI 工程工作流抽成可复用的工具，开源出去。

## 经历

早期写 Python 和 Go，搞爬虫、数据采集、分布式应用框架。后来转向云原生——容器运行时、Kubernetes、GPU 集群调度。

2024 之后随着大模型推理走向千卡万卡集群，工作重心整体迁到 **AI Infra**：模型部署、推理优化、大规模 serving。每天都在跟性能数字、显存、网络带宽较劲。

## 在造的工具

造东西我在行，但前 10 年一直在给别人造。2026 年开始**给自己造**。

**[distro](https://github.com/jiusanzhou/distro)** — 内容分发 CLI

写一篇 Markdown，自动改写成 Twitter thread、掘金文章、知乎帖子、小红书帖子、英文博客。还能生成小红书配图卡片、渲染 Mermaid 图表、检测 AI 写作痕迹。

**automagent** — 手机端 AI Agent

用 Flutter 写的，能看屏幕、理解 UI、自动操作手机。跑在手机本体上，不需要连电脑。多模型支持，多平台兼容。

**多 Agent 工作流**

跑着一套多 Agent 系统管理日常工程和写作。三个 Agent 各管一摊：

- 小Z 负责规划和调度
- 巡查负责监控和数据采集
- 营造负责写代码和搭项目

它们之间通过文件协议协作，每天产出 plan / summary / patch，全程留痕。

## 技术栈

**主战场**：Python（推理 / Serving / 训练对接）、Go（后端 / 平台 / CLI 工具）、CUDA 周边工具链

**AI 推理**：vLLM、SGLang、TensorRT-LLM、Triton、Ray、NCCL

**基础设施**：Kubernetes、Docker、RDMA / InfiniBand、GPU Device Plugin、NRI

**还在用**：Flutter（移动端 Agent）、Rust（系统级工具）、React/Next.js（前端）

**偏好**：干净架构、能用自己的轮子就用自己的、讨厌过度设计、喜欢把复杂的东西封装成一行命令。

## 开源项目

- [k8s-rdma-device-plugin](https://github.com/jiusanzhou/k8s-rdma-device-plugin) — K8s 上的 RDMA 设备权限自动注入与 GPU 拓扑亲和
- [distro](https://github.com/jiusanzhou/distro) — 内容分发 CLI，写一次发到所有平台
- [x](https://github.com/jiusanzhou/x) — Go 工具库和 CLI 框架
- [nextjs-starter-zoe-app](https://github.com/jiusanzhou/nextjs-starter-zoe-app) — 本站模板
- 更多在 [GitHub](https://github.com/jiusanzhou)

## 写作方向

主要写：

- **AI Infra 实战**：LLM 推理调优、GPU 调度、RDMA、平台工程踩坑
- **AI Ops 工具**：怎么用 AI / 工具链把开发流程自动化
- **被动收入实验**：从零搭建可持续收入系统，每月公开数据

中文原稿写一次，distro 自动分发到多平台。

## 这个站点

用我自己的 [nextjs-starter-zoe-app](https://github.com/jiusanzhou/nextjs-starter-zoe-app) 搭的。Next.js + Tailwind + shadcn/ui，YAML 驱动配置，Markdown 写内容。

## 联系方式

- GitHub: [jiusanzhou](https://github.com/jiusanzhou)
- Twitter: [@jiusanzhou](https://twitter.com/jiusanzhou)
- Telegram: [@noboddyim](https://t.me/noboddyim)
- Email: [hi@zoe.im](mailto:hi@zoe.im)

聊 AI Infra、聊 LLM 推理、聊开源工具、聊被动收入实验，都欢迎。直接找我，不用客气。
