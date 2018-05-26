!function(e, t) {
    function i(e) {
        e = e || {},
        this.config = n(e, m),
        this.subTree = {
            t: {},
            h: []
        },
        this.pubItems = {}
    }
    if (!e.MessageBus) {
        var r = 1
          , a = Object.prototype.toString
          , n = function(e, t) {
            if (e)
                for (var i in t)
                    "undefined" == typeof e[i] && (e[i] = t[i]);
            return e
        }
          , s = function(e) {
            return (e || "") + r++
        }
          , c = function(e) {
            throw new Error(e)
        }
          , o = function(e) {
            c("illegalTopic:" + e)
        }
          , u = function(e) {
            (!e || !e.length || "[object String]" != a.call(e) || /\*{2}\.\*{2}/.test(e) || /([^\.\*]\*)|(\*[^\.\*])/.test(e) || /(\*\*\.\*)|(\*\.\*\*)/.test(e) || /\*{3}/.test(e) || /\.{2}/.test(e) || "." == e[0] || "." == e[e.length - 1]) && o(e)
        }
          , l = function(e) {
            var t = /[^a-zA-Z0-9-_\.\*]/.exec(e);
            t && c("illegalCharactor:" + t[0])
        }
          , h = function(e) {
            (!e || !e.length || "[object String]" != a.call(e) || e.indexOf("*") != -1 || "." == e[0] || /\.{2}/.test(e) || "." == e[e.length]) && o(e)
        }
          , d = function(e, t, i, r) {
            t = "undefined" == typeof t ? null : t;
            for (var n, s, c = function(e, t, i, r) {
                var a = !0;
                t[i] = r,
                e[i] = !0;
                for (var n in e)
                    if (!e[n]) {
                        a = !1;
                        break
                    }
                return a
            }, o = function(e, t) {
                for (var i in e)
                    e[i] = !1
            }, u = 0, l = i.length; u < l; u++)
                n = i[u],
                !n || "undefined" != typeof r && n.pubId === r || (n.pubId = r,
                s = n.config,
                s && s._topics ? c(s._topics, s.topics, e, t) && (o(s._topics, s.topics),
                n.h.call(n.scope, e, s.topics, n.data)) : (n.execedTime++,
                "[object Number]" == a.call(n.config.execTime) && n.execedTime >= n.config.execTime && (i[u] = null),
                n.h.call(n.scope, e, t, n.data)))
        }
          , p = function(e, t) {
            for (var i = 0, r = e.length; i < r; i++)
                if (e[i] && e[i].sid == t) {
                    e[i] = null;
                    break
                }
        }
          , g = function(e, t) {
            return e == t || "**" == t || (t = t.replace(/\.\*\*\./g, "(((\\..+?\\.)*)|\\.)"),
            t = t.replace(/^\*\*\./, "(.+?\\.)*"),
            t = t.replace(/\.\*\*$/, "(\\..+?)*"),
            t = t.replace(/\.\*\./g, "(\\..+?\\.)"),
            t = t.replace(/^\*\./g, "(.+?\\.)"),
            t = t.replace(/\.\*$/g, "(\\..+?)"),
            /[^\.|\*]$/.test(t) && (t += "$"),
            new RegExp(t).test(e))
        }
          , f = function(e, t) {
            var i = [];
            for (var r in t)
                g(r, e) && i.push({
                    topic: r,
                    value: t[r]
                });
            return i
        }
          , m = {
            cache: !0
        };
        n(i.prototype, {
            version: "1.0",
            subscribe: function(t, i, r, a, n) {
                u(t),
                l(t),
                r = r || e,
                n = n || {};
                var c = s()
                  , o = {
                    h: i,
                    scope: r,
                    data: a,
                    sid: c,
                    execedTime: 0,
                    config: n
                }
                  , h = t.split(".")
                  , p = 0
                  , g = h.length;
                if (function(e, t, i, r) {
                    var a = e[t];
                    t == e.length ? r.h.push(i) : (r.t[a] || (r.t[a] = {
                        t: {},
                        h: []
                    }),
                    arguments.callee.call(this, e, ++t, i, r.t[a]))
                }(h, 0, o, this.subTree),
                this.config.cache && n.cache) {
                    var m = f(t, this.pubItems);
                    for (p = 0,
                    g = m.length; p < g; p++)
                        d(m[p].topic, m[p].value, [o])
                }
                return t + "^" + c
            },
            publish: function(e, t) {
                h(e),
                l(e),
                this.pubItems[e] = t;
                var i = e.split(".");
                !function(e, t, i, r, a, n, s) {
                    var c = e[t];
                    t == e.length ? d(a, r, s && s.isWildcard ? i.t["**"].h : i.h, n) : (i.t["**"] && (i.t["**"].t[c] ? arguments.callee.call(this, e, t + 1, i.t["**"].t[c], r, a, n, {
                        index: t,
                        tree: i
                    }) : arguments.callee.call(this, e, t + 1, i, r, a, n, {
                        isWildcard: !0
                    })),
                    i.t[c] ? arguments.callee.call(this, e, t + 1, i.t[c], r, a, n) : s && !s.isWildcard && arguments.callee.call(this, e, ++s.index, s.tree, r, a, n, s),
                    i.t["*"] && arguments.callee.call(this, e, t + 1, i.t["*"], r, a, n))
                }(i, 0, this.subTree, t, e, s())
            },
            unsubscribe: function(e) {
                for (var t = this, i = function(e) {
                    var e = e.split("^");
                    2 != e.length && c("illegal sid:" + e);
                    var i = e[0].split(".")
                      , r = e[1];
                    !function(e, t, i, r) {
                        var a = e[t];
                        t == e.length ? p(i.h, r) : i.t[a] && arguments.callee.call(this, e, ++t, i.t[a], r)
                    }(i, 0, t.subTree, r)
                }, e = e.split(";"), r = 0, a = e.length; r < a; r++)
                    i(e[r])
            },
            wait: function(e, t, i, r, n) {
                if ("[object Array]" === a.call(e) && e.length) {
                    n = n || {},
                    n.topics = {},
                    n._topics = {};
                    for (var s, c = [], o = 0, u = e.length; o < u; o++)
                        s = e[o],
                        h(e[o]),
                        n.topics[s] = null,
                        n._topics[s] = !1;
                    for (o = 0; o < u; o++)
                        c.push(this.subscribe(e[o], t, i, r, n));
                    return c.join(";")
                }
            }
        }),
        e.messagebus = new i,
        e.MessageBus = i
    }
}(window, void 0),
function(e, t, i) {
    e.zi = {},
    zi.getUrlParam = function(t) {
        var i = new RegExp("(^|&)" + t + "=([^&]*)(&|$)")
          , r = e.location.search.substr(1).match(i);
        return null != r ? unescape(r[2]) : null
    }
    ,
    zi.updateHtmlTitle = function(e) {
        var i = t("body");
        document.title = e;
        var r = t('<iframe src="https://zi.com/w/favicon.ico" style="display:none"></iframe>').on("load", function() {
            setTimeout(function() {
                r.off("load").remove()
            }, 0)
        }).appendTo(i)
    }
    ,
    zi.loadCss = function(e, t) {
        var i = document.createElement("link");
        i.type = "text/css",
        i.rel = "stylesheet",
        i.href = e,
        t && (i.onload = t),
        document.getElementsByTagName("head")[0].appendChild(i)
    }
    ,
    zi.loadJs = function(e, i) {
        var r = document.createElement("script");
        r.type = "text/javascript",
        r.src = e,
        i && (r.onload = i),
        t("body").after(r)
    }
    ,
    zi.IsURL = function(e) {
        return /zi\.com/.test(e)
    }
    ,
    zi.timeOf = function(e) {
        var t = new Date(e);
        return t.getFullYear() + "-" + (t.getMonth() + 1) + "-" + t.getDate() + " " + t.getHours() + ":" + t.getMinutes() + ":" + t.getSeconds()
    }
    ,
    zi.subString = function(e, t, i) {
        if (!e || t <= 0)
            return "";
        i || (i = ""),
        e = e.replace(/(\n)/g, "");
        for (var r = 0, a = 0; a < e.length; a++) {
            if (e.charCodeAt(a) > 255 ? r += 2 : r++,
            r == t)
                return e.substring(0, a + 1) + i;
            if (r > t)
                return e.substring(0, a) + i
        }
        return e
    }
    ,
    zi.Resizedevice = function() {
        /(iPhone|iPad|iPod)/i.test(navigator.userAgent) ? t("html").attr("class", "ios") : /(Android)/i.test(navigator.userAgent) ? (t("html").attr("class", "android"),
        zi.android = !0) : t("html").attr("class", "pc")
    }
    ,
    zi.Resizedevice(),
    t(e).resize(zi.Resizedevice),
    zi.weixin = "micromessenger" == navigator.userAgent.toLowerCase().match(/MicroMessenger/i),
    zi.weibo = "weibo" == navigator.userAgent.toLowerCase().match(/WeiBo/i),
    e.shareData || (e.shareData = {
        timeLineImg: "https://zi.com/w/images/logo.jpg",
        friendImg: "https://zi.com/w/images/logo.jpg",
        timeLineLink: "",
        sendFriendLink: "",
        weiboLink: "",
        tTitle: "字里行间",
        fContent: "字里行间",
        fTitle: "字里行间",
        timeLineImgGary: "",
        timeLineImgGaryArry: [],
        shareCallBackHtmlForGary: ""
    }),
    zi.cookie = {
        addCookie: function(e, t, i) {
            i = i || 0;
            var r = "";
            if (0 != i) {
                var a = new Date;
                a.setTime(a.getTime() + 1e3 * i),
                r = "; expires=" + a.toGMTString()
            }
            document.cookie = e + "=" + escape(t) + r + "; path=/"
        },
        getCookie: function(e, t) {
            t = t || "=";
            var i, r = "", a = e + t, n = document.cookie + ";", s = n.indexOf(e);
            return s > -1 && (s += a.length,
            i = n.indexOf(";", s),
            r = n.substring(s, i)),
            r
        }
    },
    e.zi.stateGary = 1,
    function() {
        if (1) {
            document.write('<script src="https://res.wx.qq.com/open/js/jweixin-1.0.0.js"></script>');
            var i = function() {
                messagebus.subscribe("core.share", function(i, r) {
                    console.info(i, "***"),
                    wx.checkJsApi({
                        jsApiList: ["onMenuShareAppMessage", "onMenuShareQQ", "onMenuShareWeibo", "onMenuShareTimeline"],
                        success: function(i) {
                            i.checkResult.onMenuShareTimeline && wx.onMenuShareTimeline({
                                title: e.shareData.tTitle,
                                link: e.shareData.timeLineLink,
                                imgUrl: e.shareData.timeLineImg || "https://zi.com/w/images/logo120x120.jpg",
                                success: function() {},
                                cancel: function() {}
                            }),
                            i.checkResult.onMenuShareAppMessage && wx.onMenuShareAppMessage({
                                title: e.shareData.fTitle,
                                desc: e.shareData.fContent,
                                link: e.shareData.timeLineLink,
                                imgUrl: e.shareData.timeLineImg || "https://zi.com/w/images/logo120x120.jpg",
                                success: function() {},
                                cancel: function() {}
                            })
                        }
                    })
                }, null, null, {
                    cache: !0
                }),
                messagebus.subscribe("core.previewImg", function(t, i) {
                    wx.checkJsApi({
                        jsApiList: ["previewImage"],
                        success: function(t) {
                            e.shareData.timeLineImgGary.length && e.shareData.timeLineImgGaryArry.length && t.checkResult.previewImage && wx.previewImage({
                                current: e.shareData.timeLineImgGary,
                                urls: e.shareData.timeLineImgGaryArry
                            })
                        }
                    })
                }, null, null, {
                    cache: !0
                });
                // get location
                wx.checkJsApi({
                    jsApiList: ["getLocation"],
                    success: function(res) {
                        if (res.checkResult.getLocation == false) {
                            alert('你的微信版本太低，不支持微信JS接口，请升级到最新的微信版本！');
                            return;
                        }
                        wx.getLocation({
                            success: function (res) {
                                var latitude = res.latitude; // 纬度，浮点数，范围为90 ~ -90
                                var longitude = res.longitude; // 经度，浮点数，范围为180 ~ -180。
                                var speed = res.speed; // 速度，以米/每秒计
                                var accuracy = res.accuracy; // 位置精度
                                alert.log(JSON.stringify(res))
                            },
                            cancel: function (res) {
                                alert('用户拒绝授权获取地理位置');
                            }
                        });
                    }
                })
            }
              , r = encodeURIComponent(location.href.replace(/\#.*/, ""));
            try {
                t.getJSON("https://zi.com/zi/mp/jsapi?url=", function(e) {
                    zi.wxError = !1,
                    wx.config({
                        debug: !1,
                        appId: "wx9cff8ab5cdfc158d",
                        timestamp: e.timestamp,
                        nonceStr: e.nonceStr,
                        signature: e.signature,
                        jsApiList: ["getLocation", "onMenuShareAppMessage", "onMenuShareQQ", "onMenuShareWeibo", "onMenuShareTimeline", "hideMenuItems", "showMenuItems", "previewImage"]
                    }),
                    wx.ready(function(e) {
                        zi.wxError || i()
                    }),
                    wx.error(function(e) {
                        zi.wxError = !0,
                        t.getJSON("https://zi.com/zi/mp/jsapi?url=" + r, function(e) {
                            zi.wxError = !1,
                            wx.config({
                                debug: !1,
                                appId: "wx9cff8ab5cdfc158d",
                                timestamp: e.timestamp,
                                nonceStr: e.nonceStr,
                                signature: e.signature,
                                jsApiList: ["getLocation", "onMenuShareAppMessage", "onMenuShareQQ", "onMenuShareWeibo", "onMenuShareTimeline", "hideMenuItems", "showMenuItems", "previewImage"]
                            }),
                            wx.ready(function() {
                                zi.wxError || i()
                            }),
                            wx.error(function(e) {
                                zi.wxError = !0
                            })
                        })
                    })
                })
            } catch (e) {}
        }
    }()
}(window, Zepto);
