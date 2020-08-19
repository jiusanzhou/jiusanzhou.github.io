---
title: 微博爬虫重构
layout: json-post
---

新加入了一家公司，看了下现在自己所在的爬虫部门的业务架构与代码，自己感觉有些许地方不是那么合理，当然这只是自己的拙见，Show me the code and result。

谁都知道，在一台机器上能跑越多的蜘蛛越节约成本，尽量把一台机器给榨干一直是我们梦寐以求的事情。所以一个好的程序是达到同样的目的消耗越小越好。

OK，现部门的实现方式是通过在机器上跑浏览器来爬取数据，对没看错，是跑浏览器！跑浏览器！跑浏览器！
对于这种实现方式，优点可能就是更拟人化（未必），可以人工监视（能看见才安全）；缺点显然，消耗太大，且不说机器上转一个桌面环境得额外消耗多少资源，单就一个Chrome消耗也不少。

那么，是不是有必要呢？我觉得这不是一个问题，这是一个答案：没必要！

我们来分析下，现在web版的微博，其实移动端或者客户端都比web端对爬取限制的宽松，因为只有web端被暴漏的可能性更大，所以web部门对限制爬虫下足了功夫。
这里还是就web端来看看。

这个版本的微博是有消息推送功能，当然是为推送消息，前端JS会隔段时间就向服务器请求数据，注意请求的不是timeline，可能服务端还真就对timeline这个接口的请求做了限制，这里请求的是remind，即为消息通知接口，地址如下，

```
http://rm.api.weibo.com/2/remind/push_count.json?trim_null=1&with_dm_group=0&with_settings=1&exclude_attitude=1&with_common_cmt=1&with_comment_attitude=1&with_common_attitude=1&with_moments=1&with_dm_unread=1&msgbox=true&with_page_group=1&with_chat_group=1&with_chat_group_notice=1&_pid=1&count=10&source=3818214747&status_type=0
```

返回数据如下，

```json
{"remind_settings":{"msgbox":2},"status":103,"app_message":[]}
```

`status`即为未查看的微博数目

先不去分析它带的参数，就这个接口而言，web端本省就是每隔一定秒数就请求一次，至少说明这个接口的请求频率限制是没有那么高，甚至是没有限制，为了验证，我在console里面简单的做了个定时器，每隔2s请求一次，这样的请求频率应该能够满足基本所有的爬虫需求。

```javascript
setInterval(function(){var xhr = new XMLHttpRequest();url="http://rm.api.weibo.com/2/remind/push_count.json?trim_null=1&with_dm_group=0&with_settings=1&exclude_attitude=1&with_common_cmt=1&with_comment_attitude=1&with_common_attitude=1&with_moments=1&with_dm_unread=1&msgbox=true&with_page_group=1&with_chat_group=1&with_chat_group_notice=1&_pid=1&count=10&source=3818214747&status_type=0";xhr.onreadystatechange = function(){if(xhr.readyState === 4){console.log(xhr.responseText)}};xhr.open('GET', url);xhr.send()}, 2000)
```

2016.03.21 21:06开始
2016.03.22 08:55查看依然成功请求
中间会有 503 (Service Unavailable)错误。

我们可以根据这个接口的返回数据来作为是否请求timeline的依据。我们消息的冗余数为2的话，那么应该就是在这个remind接口返回的消息条数的数据中，只要大于1就去请求timeline，而且是肯定有新数据的，但是这个数据应该是大于等于1的，因为有可能在请求玩remind接口后又有了新的数据。

客户端版本的微博api应该限制也是比较少的，timeline请求如下，

```
http://api.weibo.cn/2/statuses/friends_timeline?trim_level=1&networktype=WIFI&is_new_photo=1&uicode=10000001&picsize=480&featurecode=10000001&c=android&i=ec53948&s=0c4125e2&ua=IPhone6s__weibo__5.4.0__android__android6.0.2&wm=5311_4002&v_f=2&v_p=22&from=1054095010&gsid=_2A257LJU3DeTxGedJ71AZ8i7Lwj6IHXVWe6__rDV6PENPuNUMf1mVlDWpbhdwhoMNzYtHe9GyVgt4N0Zt&lang=en_US&trim=1&device_id=a2923eead53464c20279e9958eec5394277f7cc7&count=1&oldwm=2421_0226&trim_page_recom=0&fast_refresh=1
```

这里使用的是tcpdump进行抓包，经测试gsid为主要的身份认证标示。
客户端应该也是有remind接口，这里就可以使用整套的客户端API，基本流程也很简单，

移动端请求timeline

```
http://m.weibo.cn/index/feed?format=cards
默认是10个，所以最好在status接近10时再来请求
这里可以通过已经登录的sina.com.cn请求
http://login.sina.com.cn/sso/login.php?url=http%3A%2F%2Fm.weibo.cn%2Findex%2Ffeed%3Fformat%3Dcards&_rand=1458614093.3234&gateway=1&service=sinawap&entry=sinawap&useticket=1&returntype=META&_client_version=0.6.11
来拿到weibo.cn的登录cookie

```

```
轮询remind接口->大于设定粒度->请求timeline接口
```

关于客户端的认证标示获取，可以专门使用一台机器安装android模拟器，安装好微博客户端，再自动登录账号，用tcpdump等抓取网卡的数据包，取得该账号的认证标示。对于自动登录账号，可以使用自动输入账号密码，亦可以模拟登录请求。

如果这里可行的话，其他的模拟行为应该不成问题。

先按着这个思路来实现一个初级版本以供测试，应该一个文件就能搞定！
