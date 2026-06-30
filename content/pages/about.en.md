---
title: About
slug: about
lang: en
translationOf: about
---

# About

I'm Zoe — an AI Infra Engineer based in Hangzhou, China.

I've been writing code for 10 years across Go, Python, Flutter, and Rust. The first half of my career was distributed systems, container scheduling, and GPU clusters. For the past two years I've gone full-stack on AI inference, and today I lead an in-house inference-serving platform at a major internet company.

## What I do now

**AI Infra** — I work with LLMs, vLLM, SGLang, and GPUs every day.

My day-to-day revolves around:

- **LLM serving**: turning large models into production services, PD-disaggregation, KV-cache transfer, long-context optimization
- **GPU clusters**: multi-GPU tensor parallelism, multi-node pipeline parallelism, NCCL/RDMA networking, topology-aware scheduling
- **Inference acceleration**: vLLM / SGLang / TensorRT-LLM deployment and tuning, quantization, continuous batching
- **Platform engineering**: making inference capacity stable, schedulable, and cheap for the teams that use it

In my off-hours I build **AI ops tools** — distilling repetitive AI-engineering workflows into reusable CLIs, then open-sourcing them.

## Background

I started out writing Python and Go — crawlers, data pipelines, distributed application frameworks. Then I pivoted to cloud-native: container runtimes, Kubernetes, GPU scheduling.

After 2024, as large-model inference moved into thousand- and ten-thousand-GPU clusters, my focus shifted entirely to **AI Infra**: model deployment, inference optimization, large-scale serving. These days I'm wrestling with throughput numbers, VRAM, and network bandwidth.

## What I'm building

I'm good at shipping things — but for the first decade I shipped them for other people. Starting in 2026, I'm **building for myself.**

**[distro](https://github.com/jiusanzhou/distro)** — a content distribution CLI

Write one Markdown post, and it rewrites for Twitter threads, Juejin, Zhihu, Xiaohongshu, English blogs. Bonus: generates social cards, renders Mermaid diagrams, and flags AI-writing tells.

**automagent** — mobile AI agent

Built in Flutter. It sees the screen, understands the UI, and drives your phone. Runs on-device, no laptop tether. Multi-model, cross-platform.

**Multi-agent workflow**

I run a small fleet of agents to manage day-to-day engineering and writing. Three roles, three lanes:

- **Z** plans and dispatches
- **Watch** monitors and gathers
- **Build** writes code and ships projects

They cooperate via a file protocol, producing daily plans, summaries, and patches — fully auditable.

## Stack

**Primary**: Python (inference / serving / training integration), Go (backend / platforms / CLIs), CUDA-adjacent tooling

**AI inference**: vLLM, SGLang, TensorRT-LLM, Triton, Ray, NCCL

**Infrastructure**: Kubernetes, Docker, RDMA / InfiniBand, GPU device plugins, NRI

**Also using**: Flutter (mobile agents), Rust (systems-level tools), React/Next.js (frontend)

**Taste**: clean architecture, reach for my own wheels when I have them, allergic to over-engineering, love wrapping hard problems behind a one-line command.

## Open-source projects

- [k8s-rdma-device-plugin](https://github.com/jiusanzhou/k8s-rdma-device-plugin) — automatic RDMA device injection and GPU topology affinity on Kubernetes
- [distro](https://github.com/jiusanzhou/distro) — content distribution CLI: write once, publish everywhere
- [x](https://github.com/jiusanzhou/x) — a Go utility library and CLI scaffold
- [nextjs-starter-zoe-app](https://github.com/jiusanzhou/nextjs-starter-zoe-app) — the template behind this site
- More on [GitHub](https://github.com/jiusanzhou)

## What I write about

Mostly:

- **AI Infra in the wild**: LLM-inference tuning, GPU scheduling, RDMA, platform-engineering war stories
- **AI ops tools**: how to automate dev workflows with AI and good tooling
- **Passive-income experiments**: building sustainable revenue from zero, with monthly public numbers

I write Chinese first, and distro fans it out across platforms (including English).

## This site

Built with my own [nextjs-starter-zoe-app](https://github.com/jiusanzhou/nextjs-starter-zoe-app). Next.js + Tailwind + shadcn/ui, YAML-driven config, Markdown content.

## Contact

- GitHub: [jiusanzhou](https://github.com/jiusanzhou)
- Twitter: [@jiusanzhou](https://twitter.com/jiusanzhou)
- Telegram: [@noboddyim](https://t.me/noboddyim)
- Email: [hi@zoe.im](mailto:hi@zoe.im)

AI infra, LLM inference, open-source tools, passive-income experiments — I'm happy to talk shop. Reach out directly, no formalities.
