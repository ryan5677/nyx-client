package com.nyxclient.mod.ui;

import net.minecraft.client.option.GameOptions;
import net.minecraft.client.option.SimpleOption;

/** The Graphics Fast/Fancy/Fabulous option, on versions that still have it. */
final class NyxGfx {
	private NyxGfx() {}

	static SimpleOption<?> graphics(GameOptions o) {
		return o.getGraphicsMode();
	}
}
