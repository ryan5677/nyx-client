package com.nyxclient.mod.ui;

import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/** Funnels the mouse events into three simple hooks so screens don't care about the event type. */
public abstract class NyxScreenBase extends Screen {
	protected NyxScreenBase(Component title) {
		super(title);
	}

	protected abstract boolean handleClick(double x, double y, int button);
	protected abstract boolean handleDrag(double x, double y);
	protected abstract void handleRelease();

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (super.mouseClicked(event, doubleClick)) return true;
		return handleClick(event.x(), event.y(), event.button());
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent event, double dx, double dy) {
		if (handleDrag(event.x(), event.y())) return true;
		return super.mouseDragged(event, dx, dy);
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		handleRelease();
		return super.mouseReleased(event);
	}
}
