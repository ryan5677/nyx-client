package com.nyxclient.mod.ui;

import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

/** Mouse input for Minecraft before 1.21.9 (x, y, button arguments). */
public abstract class NyxScreenBase extends Screen {
	protected NyxScreenBase(Text title) {
		super(title);
	}

	protected abstract boolean handleClick(double x, double y, int button);
	protected abstract boolean handleDrag(double x, double y);
	protected abstract void handleRelease();

	@Override
	public boolean mouseClicked(double x, double y, int button) {
		if (super.mouseClicked(x, y, button)) return true;
		return handleClick(x, y, button);
	}

	@Override
	public boolean mouseDragged(double x, double y, int button, double dx, double dy) {
		if (handleDrag(x, y)) return true;
		return super.mouseDragged(x, y, button, dx, dy);
	}

	@Override
	public boolean mouseReleased(double x, double y, int button) {
		handleRelease();
		return super.mouseReleased(x, y, button);
	}
}
