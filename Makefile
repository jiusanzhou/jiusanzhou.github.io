theme_dir=themes/hugo-casper-two

default: dep build clean

dep:
	git clone https://github.com/jiusanzhou/hugo-casper-two $(theme_dir)

build:
	hugo

clean:
	rm -rf themes
