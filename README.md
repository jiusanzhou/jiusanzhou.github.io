# zoe.im

Zoe 的个人主页，托管在 [zoe.im](https://zoe.im)。

使用 [nextjs-starter-zoe-app](https://github.com/jiusanzhou/nextjs-starter-zoe-app) 作为主题引擎，通过 GitHub Actions 自动构建部署到 GitHub Pages。

## 结构

- `zoe-site.yaml` — 站点配置（标题、导航、Hero、标签等）
- `content/posts/` — 博客文章（Markdown）
- `content/pages/` — 独立页面
- `public/images/` — 静态资源
- `.github/workflows/deploy.yml` — CI/CD 部署流程
