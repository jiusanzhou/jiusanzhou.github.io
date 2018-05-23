---
title: 微信客户端sql抓取
layout: json-post
---

> 微信抓取最稳定的方法是客户端抓取，但这也是最困难的抓取方法，这里提供一个抓取的思路。

### 抓取背景

* 微信客户端（Android）的推送服务是长连接，但是并不能保证公众账号的文章能够及时或者优先被推送；
* 长连接的每次心跳推送会修改`/data/data/con.tencent.mm/MicroMsg/{hash}/EnMicroMsg.db`;
* 该db是使用`sqlcipher`开源工具加密，注意是db加密，并不是数据加密；
* db的加密密码是`hash(IMEI+UIN)[:7]`；
* IMEI即手机的串号，UIN为微信账号的内部ID，IMEI能直接在手机内读取，UIN能在手机内读取最后一次登录的账号的。

### 抓取思路

主要思路是读取EnMicroMsg.db这个数据库的内容，
公众账号的文章同样是在message表中，
据此便能在不影响微信的情况下，很顺利的拿到推送消息（不是内容）。

对于推送的及时性，思路可以是这样，监测这个EnMicroMsg.db文件，
如果在*分钟内没有修改，那就启动微信的主activity，等待一定时间后再销毁（或不销毁）。

启动方法：

```bash
am start -n com.tencent.mm/com.tencent.mm.UI.Launcher
```

### 研究进度

现在能够查看message表中内容，公众号的消息会在以下两个Field中区别于普通消息：

```json
{
    "content": "~SEMI_XML~", //暂时不确定这个是string还是data
    "bizClientMsgId": "mmbizcluster_1_3077155302_405050727"
}
```

其中`bizClientMsgId`是重点，因为在该数据库（其他的Index，Sns不是消息内容）并不能直接找到文章的url，abstrac等。
推测，url是由这个字段拼接而成。

> `rconversation`表同样有记录消息（摘要）。

完整的url如下，

```
http://mp.weixin.qq.com/s?__biz=MzA3NzE1NTMwMg==&mid=2650660112&idx=1&sn=b041276dd158bf917b195b33ec9ef2c6
```

其中，

* `__biz`为公众号id的base64编码值，即上面示例的`bizClientMsgId`字段中的`3077155302`，
* `mid`暂时还没有找到，
* `idx`为`bizClientMsgId`字段中的`1`，
* `sn`应该是上面三个值某种算法的hash值，服务端根据这个值来做校验。

### 所遇问题

* `bizClientMsgId`中的`405050727`还没有参与计算，同时url中的`mid`不知从何计算，从某种角度来说，这两个值应该是有关系的；

* 暂时还没有校验参数`sn`的具体计算方法。

> 目前还不清楚web端返回的是不是直接的url，如果不是可以在js上找到计算方法；
如果不行，只有反编译apk
