theme_dir=themes/hugo-casper-two

default: dep build

dep:
	@rm-rf $(theme_dir) && @git clone https://github.com/jiusanzhou/hugo-casper-two $(theme_dir)

build:
	@hugo

clean:
	@rm -rf themes
