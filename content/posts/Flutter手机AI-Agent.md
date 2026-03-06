---
title: "用 Flutter 做一个能控制手机的 AI Agent"
date: 2026-03-01
tags: [flutter, ai-agent, mobile, llm, automation]
platforms: [juejin, zhihu, blog-en]
published: true
---

# 用 Flutter 做一个能控制手机的 AI Agent

如果你的手机能自己操作自己？

不是录制宏，不是固定脚本。是一个 AI，看着屏幕，理解上面有什么，然后决定下一步做什么。

我用 Flutter 做了一个。

## 核心循环

四步，重复执行直到完成：

1. **观察** — 截屏，读取 UI 树
2. **思考** — 把截图和 UI 树发给 LLM："该做什么？"
3. **执行** — 点击、滑动、输入
4. **反思** — 检查结果，更新记忆

标准 Agent 循环。区别在于它跑在真实手机上，不是浏览器里。

## 为什么用 Flutter

它跑在手机本体上。不需要电脑，不需要 USB 线，是一个独立 App。

跨平台。同一套代码 iOS 和 Android 都能用。市面上大部分手机 Agent 项目（阿里 Mobile-Agent、腾讯 AppAgent）都需要一台电脑通过 ADB 连着手机。这个不需要。

原生性能。Flutter 编译成原生代码，UI 自动化层直接调用无障碍服务，没有网络往返延迟。

## 架构

### LLM Provider

统一接口支持多个模型：

```dart
abstract class LLMProvider {
  Future<LLMResponse> chat(List<ChatMessage> messages);
  Stream<String> chatStream(List<ChatMessage> messages);
  bool get supportsVision;
}
```

OpenAI、Claude、Gemini、Ollama 都实现同一个接口。一个 ModelRouter 根据任务复杂度自动选模型。

### UI 自动化

Android 端用 Accessibility Service，拿到完整 UI 树——每个元素的类型、文本、位置。能执行点击、滚动、文字输入、截屏。

```dart
abstract class UIService {
  Future<UISnapshot> getSnapshot();  // 截图 + UI 树
  Future<void> tap(UIElement element);
  Future<void> input(UIElement element, String text);
  Future<void> scroll(Offset delta);
}
```

Snapshot 有两部分：截图让 LLM 看到屏幕内容，结构化 UI 树用于精确定位元素。两个都给 LLM，既有视觉上下文也有结构化数据。

### Agent 核心

```dart
Stream<AgentEvent> execute(String instruction) async* {
  while (step < maxSteps) {
    final snapshot = await ui.getSnapshot();
    final decision = await think(provider, snapshot, instruction);
    
    if (decision.isComplete) {
      yield AgentEvent.completed(decision.summary);
      return;
    }
    
    await executeAction(decision.action);
    memory.addStep(step, decision);
  }
}
```

用 Stream 返回事件，UI 实时显示进度："正在观察屏幕..."、"思考中..."、"点击登录按钮..."。

## 多模型策略

做这个项目学到的一课：别什么都用同一个模型。

屏幕观察需要视觉能力，GPT-4o 或 Claude 处理得不错。简单决策比如"点这个按钮"，小模型就够了，更快更便宜。复杂推理比如在嵌套设置菜单里导航，才需要重型模型。

```text
简单操作      → Claude Haiku        (~$0.001)
视觉分析      → GPT-4o / Claude     (~$0.01)
复杂规划      → Claude Opus         (~$0.05)
```

每个任务平均成本不到 $0.10。

## 接下来做什么

任务模板——常用操作的预设流程："发社交媒体"、"点外卖"、"给某人发消息"。

定时任务——"每天早上检查邮件，生成摘要。"

任务链——多步骤工作流："截取数据统计、写报告、发邮件。"

还有 iOS 支持。现在 Android 先跑起来，iOS 接下来做。
