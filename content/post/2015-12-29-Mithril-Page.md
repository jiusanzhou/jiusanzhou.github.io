---
title: SPA Mithril文档
layout: json-post
Date: 
template: river
---

> 本项目，是在Typecho的基础上进行的扩展开发，并尽量使用其API来开发功能。由于他提供的钩子并不能完全满足开发需要，所欲有部分是接增加了他的源码，具体下面说明。

<!--more-->

## 0. 开发

### 0. 主要功能

* 数据请求的API接口
* 单页应用的主题
* 提供类似`jeklly`的编辑模版,提高页面的灵活性

### 1. 说明

插件名：API
主题名：Mithril SPA

没时间仔细看Typecho的源码，基本没有使用他的公有函数

### 2. 新增和修改的数据库结构

#### 2.1新增

* `resources`表，保存请求的资源（只增未减）
* `rls_resources`表，文章与异步资源的关系表
* `banners`表，文章封面表（拆开主要是为了扩展，多文章同封面），（只增未减）

#### 2.2增加字段

* 在`contents`表中增加了`bid`字段，封面

### 3. API接口

入口： `index.php/api/`

> 现版不可设置


|地址|请求|返回|作用|
|:-:|:-:|:-:|:-:|
|`config.json`||网站配置信息(`json`)|供前端初始化使用|
|`pages.json`||独立页面列(`json`)表|渲染`header`上的`nav bar`，现版本是在后渲染|
|`pagesfull.json`||独立页面列表，包含独立页面的具体内容(`json`)||
|`page/$.json`|页面的`slug`|页面数据(`json`)|给`js`在点击导航栏的链接后加载使用，即展示新页面|
|`post/$.json`|文章的`cid`|文章数据(`html`)||


### 4. 用到的外部库


|名称|官网|作用|路径|
|:-:|:-:|:-:|:-:|
|Twig|http://twig.sensiolabs.org/|完成自定义渲染功能|`plugins/mithril/Twig/`|


### 5. 有待完善的功能

* 二级分类
* 封面管理
* 异步资源管理
* 七牛或者新浪的Storage文件上传
* 上传文件的管理
* 在完成文件上传之后，对图片和异步文件的添加通过文件管理完成。
* 编辑器扩展
* 前端后天数据的过滤、检查等
* 把各种数据抽取出来，通过后台设置完成
* 对用户写入的地址进行容错（主要是相对路径问题）处理
* Twig的模板存储，现版本是直接`new`一个新的
* 后台管理SPA

### 6. 源码修改


|文件|行数|说明|
|:-:|:-:|:-:|
|admin/custom-fields.php|7|增加一个钩子，异步资源，封面数据的发布|
|admin/custom-fields-js.php||输出js文件|
|var/Widget/Contents/Post/Edit.php|586|获取已经添加的异步资源|
|var/Widget/Contents/Post/Edit.php|586|获取已经添加的封面|


## 1. 使用

### 0. 注意事项

* 独立页面中的`slug`为`index`的文件谨慎修改内容，不能修改或者删除`index`
* Mithril是支持3种url模式的，但由于数据实在后台渲染完成，用的是`#`模式，所以不得修改前端的`route.model`
* 现版本的`meta`等数据是没有从后台获取是直接在`index`文件中，直接修改即可
* 各个需要提交数据的地方没有做数据检查，所以请按规定格式填入数据，有错误没有提示
* 封面两项的数据均为`varchar(255)`，所以不要超过
* 独立页面的语法请参考`Twig`的文档
* 缩略名尽量不要含有`-`，如果有的话，在选取的时候应该用`posts['a-b']`，而不是`posts.a-b`
* `slug`需要作为链接id使用，特别是在独立页面
* 独立页面的`slug`是和`main.js`中的api写死对应，所以不要单独修改独立页的`slug`

### 1. 使用说明

在独立页面中有两个（应该是三个）变量，

* `posts`
* ~~`site`~~
* `theme`

在独立页面模版中，`\{\%  \%\}`为代码段，`{{  }}`为变量取值

`posts`的数据为所有分类发布的文章，不包括独立页面。示例数据如下：
```json
{
    news: {
        count: 5,
        name: "新闻",
        description: "新闻分类的描述",
        slug: "news",
        articles: [
            {   
                title: "第一篇新闻"
                author: "John",
                excerp: "摘要一共100字，超过部分是'...'，现版本不支持自定义",
                time: "1454312047128",
                banner: {
                    img: "http://...",
                    title: "显示在封面上的文字"
                },
                text: "正文全文..."
            },
            ...
        ]
    }
}
```

在新闻的页面中显示新闻

```html
<h2>{{ posts.news.name }}<h2>
<p>一共有：{{ posts.news.count }}篇, posts.news.description</p>
{% for item in posts.news.articles %}
<div class="news-item">
    <div class="left">
        <img src="{{ item.banner.img }}" alt="{{ item.banner.title }}">
    </div>
    <div class="right">
        <h3><a href="#/view/{{ item.slug }}">{{ item.title }}</a></h3>
        <p><span>{{ item.author }}</psan>发表于，{{ item.time | D-M-Y }}</p>
        <p>{{ item.excerp }}</p>
    </div>
</div>
{% endfor %}
```

### 2. 现版本可用变量

#### 2.1 独立文章发布页

* posts

```json
{
    news: {
        count: 5,
        name: "新闻",
        description: "新闻分类的描述",
        slug: "news",
        articles: [
            {   
                title: "第一篇新闻"
                author: "John",
                excerp: "摘要一共100字，超过部分是'...'，现版本不支持自定义",
                time: "1454312047128",
                banner: {
                    img: "http://...",
                    title: "显示在封面上的文字"
                },
                text: "正文全文..."
            },
            ...
        ]
    },
    ...
}
```

* theme

```
{
    url: "usr/themes/Mithril/"
}
```

#### 2.2 INDEX框架页

* posts
同上
* headers
```json
[
    {
        slug: "news",
        title: "新闻"
    },
    ...
]
```

* theme

```
{
    url: "usr/themes/Mithril/"
}
```
