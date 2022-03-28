PLUGIN = au.com.clearwater.osxvpn.sdPlugin
TARGET = Release/au.com.clearwater.osxvpn.streamDeckPlugin

build:
	mkdir -p Release
	rm -rf $(TARGET)
	(cd Sources && zip -r - $(PLUGIN) $(PLUGIN)/*) > $(TARGET)

install:
	open $(TARGET)
