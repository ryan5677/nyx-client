package com.nyxclient.mod.ui;

import net.minecraft.client.gui.Click;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

/** Mouse input for Minecraft 1.21.9 and later, where events arrive as a Click object. */
public abstract class NyxScreenBase extends Screen {
	protected NyxScreenBase(Text title) {
		super(title);
	}

	protected abstract boolean handleClick(double x, double y, int button);
	protected abstract boolean handleDrag(double x, double y);
	protected abstract void handleRelease();

	@Override
	public boolean mouseClicked(Click click, boolean doubled) {
		if (super.mouseClicked(click, doubled)) return true;
		return handleClick(click.x(), click.y(), click.button());
	}

	@Override
	public boolean mouseDragged(Click click, double offsetX, double offsetY) {
		if (handleDrag(click.x(), click.y())) return true;
		return super.mouseDragged(click, offsetX, offsetY);
	}

	@Override
	public boolean mouseReleased(Click click) {
		handleRelease();
		return super.mouseReleased(click);
	}
}
