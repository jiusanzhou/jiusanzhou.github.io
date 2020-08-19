---
title: 雪球爬虫分析
layout: json-post
---

雪球平台无API接口，请求的数据均为渲染好的html数据。

账号注册需要手机验证，captcha可识度较低。

如果直接在这一步骤提取出数据可以使用BeautifulSoup库来简化操作，否则直接使用正则匹配出div中的a，形如`/1287305957/66319002`。域名为根域名，目前为`xueqiu.com`。

```python
html = request.content
HOST = "http://xueqiu.com"

for div in html.body.div:
    uid            = div['data-uid']
    did            = div['data-id']
    # 该条数据的详情url
    detail_url     = "{}/{}/{}".format(HOST, uid, did)
    content        = div.div['.status-bd'][1].div['.status-content']
    detail_url     = content['h4.status-title>a']['href']
    detail_title   = content['h4.status-title>a'].text
    detail_content = content['div.detail'].div['.text'].html
```

未阅读消息接口

```
http://xueqiu.com/remind/unread.json?_=1458614506219
```

timeline接口

```
http://xueqiu.com/service/partials/home/timeline?since_id=66029490&source=
```

登录接口

```
http://xueqiu.com/user/login

POST

username:
areacode:86
telephone:15655400686
remember_me:1
password:028EA4876663F4D15EB5F3437101773B

其中password 为密码32位md5大写

```

所有接口无cookie会返回
```json
{"error_description":"遇到错误，请刷新页面或者重新登录帐号后再试","error_uri":"/stock/search.json","error_code":"400016"}
```

请求这个接口会设置以下cookie值，可请求其他接口

https://xueqiu.com/service/csrf?api=%2Fuser%2Flogin

Set-Cookie:s=23y213nb96; domain=.xueqiu.com; path=/; expires=Fri, 14 Apr 2017 11:29:00 GMT; httpOnly
Set-Cookie:xq_is_login=; domain=xueqiu.com; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT
Set-Cookie:xq_a_token=b24582049f392ccbbbbd07ff7c20b1c642299e8c; domain=.xueqiu.com; path=/; httpOnly
Set-Cookie:xq_r_token=2ca7bd350f25ed0fab87c678da0e90b22cae3412; domain=.xueqiu.com; path=/; httpOnly


推荐内容

```

https://xueqiu.com/cubes/discover/rank/cube/list.json?category=12&count=10&market=cn&profit=daily_gain

```

用户搜索接口

```
http://xueqiu.com/users/search.json?q=%E4%BD%A0&count=1&sg=1
```

搜索建议接口

```
http://xueqiu.com/users/search/suggest.json?q=%E4%BD%A0&count=3

https://xueqiu.com/stock/search.json?code=z&size=5&key=47bce5c74f

https://xueqiu.com/imgroups/search.json?q=z&count=3&sg=1
```


查看用户

```
http://xueqiu.com/user/show.json?id=%E7%BE%8E%E4%B8%BD%E7%9A%84%E5%BF%83%E4%B8%AD%E6%9C%89%E4%B8%80&_=1458710552921
```

关注接口

```
http://xueqiu.com/service/poster

POST

url:/friendships/create/1492448550.json
data[remark]:true
data[_]:1458621400786
```

取消关注

```
http://xueqiu.com/service/poster

POST

url:/friendships/destroy/1492448550.json
data[_]:1458622520646
```

获取提交token

```
http://xueqiu.com/service/csrf?api=%2Ffriendships%2Fgroups%2Fcreate.json&_=1458621499235
```

获取所有组

```
http://xueqiu.com/friendships/groups.json?_=1458621401004
```

新建分组

```
http://xueqiu.com/service/poster

POST

url:/friendships/groups/create.json
data[name]:11111
data[_]:1458621499234
session_token:hyBEKZE56V1AjK5ziMsmX
```

添加组成员

```
http://xueqiu.com/service/poster

POST

url:/friendships/groups/members/add.json
data[uid]:1492448550
data[gid]:12984431
data[_]:1458621594310
session_token:joGyDELD4xSjdzf8tfd6pt
```

### 拟定数据库

#### 账号表-accounts

id
weixin_id
weibo_id
qq_id
email
phone
nickname
pwd
encodepwd
cookie
status({0: 'normal', -1: 'drop', 2: 'relogin', 3: 'reject'})
lastid

#### 关注目标表-targets

id
uid
nickname
byid

#### 内容表

id
uid
cid
ctime
atime
title
content
