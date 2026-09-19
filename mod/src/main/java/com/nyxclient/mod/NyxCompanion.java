package com.nyxclient.mod;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * Draws the Nyx HUD overlays (FPS, coordinates, CPS) as one draggable block.
 * Everything it shows, and whether drag-to-reposition is unlocked, is driven
 * by NyxConfig, which reads the launcher's config file - the launcher owns
 * the on/off switches, this mod owns where the block actually sits and how
 * it's drawn.
 *
 * Position is intentionally NOT read from the launcher's config: the
 * launcher rewrites that file periodically (any settings change), and a
 * drag saved there could get raced/overwritten by an unrelated launcher
 * save. Position lives in its own small mod-owned file instead
 * (NyxPosition), written only by this mod, only when a drag ends.
 */
public class NyxCompanion implements ClientModInitializer {
	private static final int LINE_HEIGHT = 11;

	private static final Deque<Long> CLICKS = new ArrayDeque<>();
	private static boolean wasAttacking = false;

	private static KeyBinding editModeKey;
	private static boolean editMode = false;
	private static boolean dragging = false;
	private static double dragStartMouseX, dragStartMouseY;
	private static double dragStartBlockX, dragStartBlockY;

	/** Called whenever the attack button goes down, for the CPS readout. */
	public static void recordClick() {
		CLICKS.addLast(System.currentTimeMillis());
	}

	private static int currentCps() {
		long cutoff = System.currentTimeMillis() - 1000L;
		while (!CLICKS.isEmpty() && CLICKS.peekFirst() < cutoff) {
			CLICKS.removeFirst();
		}
		return CLICKS.size();
	}

	@Override
	public void onInitializeClient() {
		editModeKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
				"key.nyx-companion.edit_hud",
				InputUtil.Type.KEYSYM,
				GLFW.GLFW_KEY_UNKNOWN, // unbound by default - the player picks a key in Controls
				"category.nyx-companion"
		));

		ClientTickEvents.END_CLIENT_TICK.register(NyxCompanion::onTick);
		// Let the lambda infer its parameter types - Fabric's HudRenderCallback
		// signature changes between Minecraft versions, so naming the types
		// explicitly here would break the build on every bump.
		HudRenderCallback.EVENT.register((context, tickDelta) -> render(context));
	}

	private static void onTick(MinecraftClient client) {
		if (editModeKey.wasPressed()) {
			editMode = !editMode;
			if (!editMode) dragging = false;
		}
		if (!editMode || client.player == null) {
			dragging = false;
			return;
		}
		handleDrag(client);
	}

	/**
	 * Polls the mouse directly via GLFW rather than hooking Minecraft's own
	 * click handling - the vanilla input system is built around Screens, and
	 * this needs to work while playing with no Screen open. Deliberately
	 * mixin-free: one fewer thing that can silently break on a Minecraft
	 * version bump.
	 */
	private static void handleDrag(MinecraftClient client) {
		long window = client.getWindow().getHandle();
		boolean leftDown = GLFW.glfwGetMouseButton(window, GLFW.GLFW_MOUSE_BUTTON_LEFT) == GLFW.GLFW_PRESS;

		double[] mx = new double[1];
		double[] my = new double[1];
		GLFW.glfwGetCursorPos(window, mx, my);
		double scale = client.getWindow().getScaleFactor();
		double mouseX = mx[0] / scale;
		double mouseY = my[0] / scale;

		if (leftDown && !dragging && hitTestBlock(client, mouseX, mouseY)) {
			dragging = true;
			dragStartMouseX = mouseX;
			dragStartMouseY = mouseY;
			dragStartBlockX = NyxPosition.x();
			dragStartBlockY = NyxPosition.y();
		} else if (!leftDown && dragging) {
			dragging = false;
			NyxPosition.save();
		}

		if (dragging) {
			int screenW = client.getWindow().getScaledWidth();
			int screenH = client.getWindow().getScaledHeight();
			double newX = dragStartBlockX + (mouseX - dragStartMouseX) / Math.max(1, screenW);
			double newY = dragStartBlockY + (mouseY - dragStartMouseY) / Math.max(1, screenH);
			NyxPosition.set(clamp01(newX), clamp01(newY));
		}
	}

	private static double clamp01(double v) {
		return Math.max(0.0, Math.min(1.0, v));
	}

	/** Rough bounding box for the currently visible block, for drag pickup. */
	private static boolean hitTestBlock(MinecraftClient client, double mouseX, double mouseY) {
		List<String> lines = visibleLines(client);
		if (lines.isEmpty()) return false;
		int screenW = client.getWindow().getScaledWidth();
		int screenH = client.getWindow().getScaledHeight();
		int blockWidth = widestLine(client.textRenderer, lines);
		int blockHeight = lines.size() * LINE_HEIGHT;
		int x = (int) (NyxPosition.x() * screenW);
		int y = (int) (NyxPosition.y() * screenH);
		return mouseX >= x - 2 && mouseX <= x + blockWidth + 2 && mouseY >= y - 2 && mouseY <= y + blockHeight + 2;
	}

	private static int widestLine(TextRenderer font, List<String> lines) {
		int widest = 0;
		for (String line : lines) widest = Math.max(widest, font.getWidth(line));
		return widest;
	}

	private static List<String> visibleLines(MinecraftClient client) {
		List<String> lines = new ArrayList<>();
		if (client.player == null) return lines;
		if (NyxConfig.getBool("fpsCounter", false)) lines.add(client.getCurrentFps() + " FPS");
		if (NyxConfig.getBool("coords", false)) {
			lines.add(String.format("%.1f, %.1f, %.1f",
					client.player.getX(), client.player.getY(), client.player.getZ()));
		}
		if (NyxConfig.getBool("cpsCounter", false)) lines.add(currentCps() + " CPS");
		return lines;
	}

	private void render(net.minecraft.client.gui.DrawContext context) {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null || client.player == null) return;
		if (client.options.hudHidden && !editMode) return;

		boolean attacking = client.options.attackKey.isPressed();
		if (attacking && !wasAttacking) recordClick();
		wasAttacking = attacking;

		List<String> lines = visibleLines(client);
		if (editMode && lines.isEmpty()) {
			// Edit mode always shows *something* to drag, even with every
			// counter off, otherwise there's nothing on screen to grab.
			lines = List.of("Nyx HUD (drag me)");
		}
		if (lines.isEmpty()) return;

		TextRenderer font = client.textRenderer;
		int color = editMode ? 0xFFFFFF : NyxConfig.accentColor();
		int screenW = client.getWindow().getScaledWidth();
		int screenH = client.getWindow().getScaledHeight();
		int x = (int) (NyxPosition.x() * screenW);
		int y = (int) (NyxPosition.y() * screenH);

		if (editMode) {
			int blockWidth = widestLine(font, lines);
			int blockHeight = lines.size() * LINE_HEIGHT;
			context.fill(x - 3, y - 3, x + blockWidth + 3, y + blockHeight + 3, dragging ? 0x552A9DF4 : 0x33FFFFFF);
		}

		int lineY = y;
		for (String line : lines) {
			context.drawTextWithShadow(font, Text.literal(line), x, lineY, color);
			lineY += LINE_HEIGHT;
		}
	}
}
