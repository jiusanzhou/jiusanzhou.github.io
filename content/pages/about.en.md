---
title: About
slug: about
lang: en
translationOf: about
---

# About

I'm Zoe — an AI Infra Engineer based in Hangzhou, China. Ten years of code in Go, Python, Flutter, and Rust.

First half of my career: distributed systems, container scheduling, GPU clusters. Last two years: full-stack on AI inference. Today I lead an in-house LLM-serving platform at a top-tier internet company.

## What I do now

**AI Infra** — I work with LLMs, vLLM, SGLang, and GPUs every day.

My day-to-day revolves around:

- **LLM serving**: turning large models into production services, PD-disaggregation, KV-cache transfer, long-context optimization
- **GPU clusters**: multi-GPU tensor parallelism, multi-node pipeline parallelism, NCCL/RDMA networking, topology-aware scheduling
- **Inference acceleration**: vLLM / SGLang / TensorRT-LLM deployment and tuning, quantization, continuous batching
- **Platform engineering**: making inference capacity stable, schedulable, and cheap for the teams that use it

Off-hours I build **AI ops tools** — distilling the repetitive parts of AI engineering into one-line CLIs and open-sourcing them.

## Background

I started on Python and Go — crawlers, data pipelines, distributed application frameworks. Then I pivoted to cloud-native: container runtimes, Kubernetes, GPU scheduling.

From 2024 onwards, as LLM inference moved into thousand- and ten-thousand-GPU clusters, I went all-in on **AI Infra**: model deployment, inference optimization, large-scale serving. These days I'm wrestling with throughput numbers, VRAM, and network bandwidth.

## What I'm building

I'm good at shipping things — and for the first decade I shipped them for other people. Starting in 2026, I'm **building for myself**.

The goal: a portfolio of small, profitable products. Real users, real revenue, no VC.

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

**Taste**: clean architecture, use my own wheels when I have them, allergic to over-engineering, obsessed with wrapping hard problems behind a one-line command.

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

I write in Chinese first; [distro](https://github.com/jiusanzhou/distro) fans the post out across platforms — this English version is one of those outputs.

## This site

Built with my own [nextjs-starter-zoe-app](https://github.com/jiusanzhou/nextjs-starter-zoe-app). Next.js + Tailwind + shadcn/ui, YAML-driven config, Markdown content.

## Contact

- GitHub: [jiusanzhou](https://github.com/jiusanzhou)
- Twitter: [@jiusanzhou](https://twitter.com/jiusanzhou)
- Telegram: [@noboddyim](https://t.me/noboddyim)
- Email: [hi@zoe.im](mailto:hi@zoe.im)

Happy to talk shop on AI infra, LLM inference, open-source tools, or indie SaaS. Skip the formalities and just ping me.
