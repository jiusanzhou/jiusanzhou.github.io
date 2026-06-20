# OG Image Templates

> **Zoe 个人主页 OG 图模板库** — 1200×630，纯 HTML+CSS，Chrome headless 出图。
> 后续可以演进成 SaaS（输入 data.json → 出 og.png）。

## 当前模板

| Key | 名称 | 风格 | 适用场景 |
|-----|------|------|---------|
| `a` | Minimal Card | 极简白底 + 渐变点缀 | 安全牌，和主页风格一致 |
| `b` | Cyberpunk | 暗色 + GPU 节点拓扑 + terminal | HN/X，技术圈传播 |
| `c` | Duality（**线上版**） | 双面：白天 GPU / 夜里 indie | 故事感最强 |

## 渲染

```bash
cd og-templates
./scripts/render.sh        # 全渲染 → output/og-a.png, og-b.png, og-c.png
./scripts/render.sh c      # 只渲染 C
./scripts/render.sh c og.png   # 自定义输出名
```

需要 macOS 上的 Chrome（`/Applications/Google Chrome.app`），或用 `CHROME=` 环境变量指定。

## 改内容

直接编辑 `templates/{a,b,c}-*.html` 里的文案。

`data.json` 是 reference schema，未来做 SaaS（输入数据 → 自动渲染）时会用到。

## 文件结构

```
og-templates/
├── README.md
├── data.json              # 数据 schema（future SaaS input）
├── templates/
│   ├── a-minimal.html     # 极简卡片
│   ├── b-cyberpunk.html   # 暗色 geek
│   └── c-duality.html     # 双面人格（线上）
├── scripts/
│   └── render.sh          # 一键渲染
└── output/                # 渲染产物（gitignored）
    ├── og-a.png
    ├── og-b.png
    └── og-c.png
```

## 当前线上

`public/images/og.png` ← C 方案（duality）

如需切换：
```bash
./scripts/render.sh a       # 渲染 A
cp output/og-a.png ../public/images/og.png   # 替换线上
```

然后 commit + push，GitHub Actions 会自动部署。

## 未来方向（SaaS）

把这套搬到 `wuma.dev` 子产品：
- 用户填表单 → 选模板 → 出图
- 接 OG 检测器（X/微信/HN 预览）
- 关键词：og image generator、Twitter card、social preview
- 客单可设 $9–19 一次性 / $5/mo 订阅

不卷 Vercel OG（用 SVG 太死板），靠"模板设计 + 中文场景"做差异化。
