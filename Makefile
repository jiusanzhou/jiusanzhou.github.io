

default: dep build

dep:
	@git clone https://github.com/jiusanzhou/hugo-casper-two themes/hugo-casper-two

build:
	@hugo

clean:
	@rm -rf themes
