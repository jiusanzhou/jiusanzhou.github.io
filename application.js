/*

  ,ad8888ba,                                                      
 d8"'    `"8b                                    ,d               
d8'                                              88               
88            8b,dPPYba,  ,adPPYba, ,adPPYYba, MM88MMM ,adPPYba,  
88            88P'   "Y8 a8P_____88 ""     `Y8   88   a8P_____88  
Y8,           88         8PP""""""" ,adPPPPP88   88   8PP"""""""  
 Y8a.    .a8P 88         "8b,   ,aa 88,    ,88   88,  "8b,   ,aa  
  `"Y8888Y"'  88          `"Ybbd8"' `"8bbdP"Y8   "Y888 `"Ybbd8"'  
                                                                  
                                                                  
                                                                           
88                                 88             88                       
88                                 88             88                       
88                                 88             88                       
88,dPPYba,  8b       d8            88  ,adPPYba,  88,dPPYba,  8b,dPPYba,   
88P'    "8a `8b     d8'            88 a8"     "8a 88P'    "8a 88P'   `"8a  
88       d8  `8b   d8'             88 8b       d8 88       88 88       88  
88b,   ,a8"   `8b,d8'      88,   ,d88 "8a,   ,a8" 88       88 88       88  
8Y"Ybbd8"'      Y88'        "Y8888P"   `"YbbdP"'  88       88 88       88

*/

(function(window, document){})(window, document);

function ready(fn) {
  if (document.readyState != 'loading'){
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

function app() {

	var baseUrl = "http://jiusanzhou.github.io",

		data = {
			title: "jiusanzhou",
		},

		helper = {
			fix_code:　function(){
				if (document.getElementsByTagName('code') != []) {
					[].map.call(document.getElementsByTagName('pre'), function(pre){
						var code = pre.firstElementChild;
						code.innerText = code.innerText;
						return 0;
					});
					hljs.initHighlighting();
				};
			},
			fix_img: function(){
				[].map.call(document.getElementById('article-detail').getElementsByTagName('img'), 
					function(img){
						img.parentNode.style.textAlign = "center";
							return 0;
						}
					)
			},
			set_title: function(el){
				document.getElementsByTagName('head')[0]
					.getElementsByTagName('title')[0]
					.innerText = el.getAttribute('data-title') + '-' + data.title;
			}
		},

		eles = {
			cnt_cnt: document.getElementById("content-container"),
			ar_dt: document.getElementById('article-detail'),
			pt_dt: document.getElementById("post-detail"),
			no: document.getElementById("nodisplay"),
		},

		indexJson = [],

		router = {
			Home: {
				controller: function() {
					console.log("Home...");
					scrollTo(0, 0);
					classie.add(eles.cnt_cnt, "loading");
					if ( indexJson.length === 0 ) {
					m.request({method: "GET", url: baseUrl + "/index.json", extract: function(xhr){return JSON.stringify(xhr.responseText.replace(/\n/g, ''))}})//"http://proxyioio.sinaapp.com/temp/"})
						.then(function(articles){
							//console.log(typeof(articles));
							indexJson = JSON.parse(articles).data;
							m.render(document.getElementById("content-container"),
								indexJson.map(function(article){			
									return m("article.post", [
										m("h3", m("a", {href: "#/post" + article.url}, article.title)),
										m("div.entry", m("p", article.entry)),
										m("a.read-more", {href: "#/post" + article.url, "data-title": article.title, onclick: function(){helper.set_title(this)}}, "阅读全文"),
										m("p.post-date", article.date)
									])
								})
							)
						});
					} else {
						indexJson.map(function(article){			
							return m("article.post", [
								m("h3", m("a", {href: "#/post" + article.url}, article.title)),
								m("div.entry", m("p", article.entry)),
								m("a.read-more", {href: "#/post" + article.url, "data-title": article.title, onclick: function(){helper.set_title(this)}}, "阅读全文"),
								m("p.post-date", article.date)
							])
						})
					}
					classie.add(eles.pt_dt, "hidden");
					classie.add(eles.pt_dt, "loading");
					classie.remove(eles.cnt_cnt, "hidden");
					return {}
				},
				view: function(c) {
					classie.remove(eles.cnt_cnt, "loading");

				}
			},
			About: {
				controller: function() {
					console.log("About...");
					scrollTo(0, 0);

				},
				view: function() {

				}
			},
			category: {
				controller: function() {
					console.log("Category...");
					scrollTo(0, 0);

				},
				view: function() {

				}
			},
			Post: {
				controller: function() {
					console.log("Post...");
					scrollTo(0, 0);
					classie.add(eles.pt_dt, "loading");
					m.request({method: 'GET', url: baseUrl + '/' + m.route.param("articleId"), deserialize: function(data){return data}})
						.then(function(content){
							console.log(baseUrl + '/' + m.route.param("articleId"));
							m.render(eles.ar_dt, m.trust(content));
						});
					classie.add(eles.cnt_cnt, "hidden");
					classie.add(eles.cnt_cnt, "loading");
					classie.remove(eles.pt_dt, "hidden");
					return {}
				},
				view: function(c) {
					classie.remove(eles.pt_dt, "loading")
				}
			}
		},

		initData = function () {
			data.title = document.getElementsByTagName('head')[0]
					.getElementsByTagName('title')[0]
					.innerText;
		},
		
		init = function(){
			console.log("Init...");
			initData();
			m.route.mode = "hash";
			m.route(eles.no, '/', {
				"/": router.Home,
				"/about": router.About,
				"/category": router.Category,
				"/post/:articleId": router.Post,
			})
		};

	init();
}

ready(app);
