package com.nyxclient.mod.ui;

import net.minecraft.client.Minecraft;
import net.minecraft.client.OptionInstance;
import net.minecraft.client.Options;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Sodium-style settings screen: tabs down the left, a list of options on the
 * right, and a description box for whatever you're hovering. Every option maps
 * straight onto a vanilla Options entry, so nothing here is Nyx-only state -
 * changes are written to options.txt exactly as the vanilla menu would.
 *
 * Drawn and hit-tested by hand (no vanilla widgets) so it behaves the same
 * across Minecraft versions; each tab is short enough to need no scrolling.
 */
public class NyxSettingsScreen extends NyxScreenBase {
	/** Set while the player has deliberately opened the vanilla menu from ours. */
	public static boolean allowVanilla = false;

	private static final int ROW_H = 24;
	private static final int ROW_GAP = 3;

	// ---- option model ----
	private interface Opt {
		String name();
		String description();
		String valueText();
		/** Click on the row. fraction is 0..1 across the control for sliders. */
		void click(float fraction, boolean drag);
		boolean isSlider();
		float fraction();
	}

	private static final class Tab {
		final String name;
		final List<Opt> options = new ArrayList<>();
		Tab(String name) { this.name = name; }
	}

	private final Screen parent;
	private final List<Tab> tabs = new ArrayList<>();
	private int tabIndex = 0;
	private Opt dragging = null;
	private boolean changed = false;

	public NyxSettingsScreen(Screen parent) {
		super(Component.literal("Nyx Settings"));
		this.parent = parent;
	}

	// ---- layout ----
	private int panelX() { return Math.max(8, this.width / 2 - 230); }
	private int panelW() { return Math.min(460, this.width - 16); }
	private int panelY() { return 28; }
	private int panelH() { return this.height - 28 - 40; }
	private int sideW() { return 96; }
	private int listX() { return panelX() + sideW() + 10; }
	private int listW() { return panelW() - sideW() - 20; }
	private int listY() { return panelY() + 28; }

	@Override
	protected void init() {
		buildTabs();
		int by = this.height - 30;
		int cx = this.width / 2;
		this.addRenderableWidget(Button.builder(Component.literal("Done"), b -> onClose())
				.bounds(cx + 6, by, 100, 20).build());
		this.addRenderableWidget(Button.builder(Component.literal("Vanilla Options"), b -> {
			allowVanilla = true;
			NyxNav.open(this.minecraft, NyxNav.vanillaOptions(this.minecraft, this));
		}).bounds(cx - 106, by, 100, 20).build());
	}

	private void buildTabs() {
		tabs.clear();
		Options o = Minecraft.getInstance().options;

		Tab general = new Tab("General");
		general.options.add(slider("Field of View", "How wide the game camera sees. 70 is the vanilla default.", o.fov(), 30, 110, ""));
		general.options.add(toggle("Fullscreen", "Run the game fullscreen. You can also toggle this with F11.", o.fullscreen()));
		general.options.add(toggle("VSync", "Lock the frame rate to your monitor's refresh rate to prevent tearing.", o.enableVsync()));
		general.options.add(slider("Max Frame Rate", "Upper frame-rate limit. The top of the slider means unlimited.", o.framerateLimit(), 10, 260, " fps"));
		general.options.add(toggle("View Bobbing", "Sway the view while you walk.", o.bobView()));
		general.options.add(slider("GUI Scale", "Size of the interface. 0 picks automatically.", o.guiScale(), 0, 4, ""));
		tabs.add(general);

		Tab quality = new Tab("Quality");
		quality.options.add(cycle("Clouds", "Cloud rendering quality, or off entirely.", o.cloudStatus()));
		quality.options.add(cycle("Particles", "How many particles are shown.", o.particles()));
		quality.options.add(toggle("Smooth Lighting", "Smoother shading on blocks. Turning it off is a little faster.", o.ambientOcclusion()));
		quality.options.add(slider("Biome Blend", "How far biome colours blend into each other. Lower is faster.", o.biomeBlendRadius(), 0, 7, " blocks"));
		quality.options.add(slider("Mipmap Levels", "Smooths distant textures. Needs a world reload to fully apply.", o.mipmapLevels(), 0, 4, ""));
		tabs.add(quality);

		Tab performance = new Tab("Performance");
		performance.options.add(slider("Render Distance", "How many chunks are drawn around you. The biggest FPS lever.", o.renderDistance(), 2, 32, " chunks"));
		performance.options.add(slider("Simulation Distance", "How far away entities and crops are ticked. Lower is lighter on the CPU.", o.simulationDistance(), 5, 32, " chunks"));
		performance.options.add(toggle("Entity Shadows", "Draw shadows under mobs and players.", o.entityShadows()));
		tabs.add(performance);
	}

	// ---- option factories ----
	private Opt toggle(String name, String desc, OptionInstance<Boolean> opt) {
		return new Opt() {
			public String name() { return name; }
			public String description() { return desc; }
			public String valueText() { return opt.get() ? "ON" : "OFF"; }
			public void click(float f, boolean drag) {
				if (drag) return;
				opt.set(!opt.get());
				changed = true;
			}
			public boolean isSlider() { return false; }
			public float fraction() { return 0f; }
		};
	}

	private Opt slider(String name, String desc, OptionInstance<Integer> opt, int min, int max, String unit) {
		return new Opt() {
			public String name() { return name; }
			public String description() { return desc; }
			public String valueText() {
				int v = opt.get();
				if (name.equals("Max Frame Rate") && v >= 260) return "Unlimited";
				if (name.equals("GUI Scale") && v == 0) return "Auto";
				return v + unit;
			}
			public void click(float f, boolean drag) {
				int v = min + Math.round(Math.max(0f, Math.min(1f, f)) * (max - min));
				if (v != opt.get()) {
					opt.set(v);
					changed = true;
				}
			}
			public boolean isSlider() { return true; }
			public float fraction() { return (opt.get() - min) / (float) (max - min); }
		};
	}

	@SuppressWarnings({"unchecked", "rawtypes"})
	private Opt cycleRaw(String name, String desc, OptionInstance<?> opt) {
		return cycle(name, desc, (OptionInstance) opt);
	}

	/** Cycles through whatever enum the option holds - no need to name the enum type. */
	private <T extends Enum<T>> Opt cycle(String name, String desc, OptionInstance<T> opt) {
		return new Opt() {
			public String name() { return name; }
			public String description() { return desc; }
			public String valueText() {
				String s = opt.get().name();
				return s.charAt(0) + s.substring(1).toLowerCase();
			}
			public void click(float f, boolean drag) {
				if (drag) return;
				T cur = opt.get();
				T[] all = cur.getDeclaringClass().getEnumConstants();
				opt.set(all[(cur.ordinal() + 1) % all.length]);
				changed = true;
			}
			public boolean isSlider() { return false; }
			public float fraction() { return 0f; }
		};
	}

	// ---- rendering ----
	@Override
	public void extractRenderState(GuiGraphicsExtractor ctx, int mouseX, int mouseY, float delta) {
		NyxTheme.gradient(ctx, 0, 0, this.width, this.height, NyxTheme.BG_TOP, NyxTheme.BG_BOTTOM);

		int px = panelX(), py = panelY(), pw = panelW(), ph = panelH();
		ctx.fill(px, py, px + pw, py + ph, NyxTheme.PANEL);
		NyxTheme.border(ctx, px, py, pw, ph, NyxTheme.accent(70));
		ctx.fill(px + sideW() + 4, py + 6, px + sideW() + 5, py + ph - 6, NyxTheme.accent(60));

		ctx.text(this.font, "NYX SETTINGS", px + 10, py + 9, NyxTheme.accent(), true);
		ctx.text(this.font, "Changes apply instantly", px + pw - 10 - this.font.width("Changes apply instantly"),
				py + 9, NyxTheme.TEXT_DIM, false);

		// tabs
		for (int i = 0; i < tabs.size(); i++) {
			int ty = py + 28 + i * 24;
			boolean active = i == tabIndex;
			boolean hover = inside(mouseX, mouseY, px + 6, ty, sideW() - 4, 20);
			if (active || hover) ctx.fill(px + 6, ty, px + sideW(), ty + 20, active ? NyxTheme.PANEL_LIGHT : NyxTheme.ROW);
			if (active) ctx.fill(px + 6, ty, px + 8, ty + 20, NyxTheme.accent());
			ctx.text(this.font, tabs.get(i).name, px + 14, ty + 6, active ? NyxTheme.TEXT : NyxTheme.TEXT_DIM, false);
		}

		// options
		Tab tab = tabs.get(tabIndex);
		Opt hovered = null;
		for (int i = 0; i < tab.options.size(); i++) {
			Opt opt = tab.options.get(i);
			int ry = listY() + i * (ROW_H + ROW_GAP);
			boolean hover = inside(mouseX, mouseY, listX(), ry, listW(), ROW_H);
			if (hover) hovered = opt;
			ctx.fill(listX(), ry, listX() + listW(), ry + ROW_H, hover ? NyxTheme.ROW_HOVER : NyxTheme.ROW);

			ctx.text(this.font, opt.name(), listX() + 8, ry + 8, NyxTheme.TEXT, false);

			if (opt.isSlider()) {
				int sw = Math.min(150, listW() / 2);
				int sx = listX() + listW() - sw - 8;
				int sy = ry + ROW_H / 2 - 2;
				ctx.fill(sx, sy, sx + sw, sy + 4, 0xFF0b0816);
				int filled = (int) (sw * Math.max(0f, Math.min(1f, opt.fraction())));
				ctx.fill(sx, sy, sx + filled, sy + 4, NyxTheme.accent());
				ctx.fill(sx + filled - 1, sy - 3, sx + filled + 2, sy + 7, 0xFFFFFFFF);
				String v = opt.valueText();
				ctx.text(this.font, v, sx - 8 - this.font.width(v), ry + 8, NyxTheme.TEXT_DIM, false);
			} else {
				String v = opt.valueText();
				int vw = this.font.width(v) + 14;
				int vx = listX() + listW() - vw - 8;
				boolean on = v.equals("ON");
				int pill = v.equals("OFF") ? 0xFF2a2440 : (on ? NyxTheme.accent(255) : NyxTheme.accent(110));
				ctx.fill(vx, ry + 4, vx + vw, ry + ROW_H - 4, pill);
				ctx.text(this.font, v, vx + 7, ry + 8, 0xFFFFFFFF, false);
			}
		}

		// description box
		int boxY = listY() + tab.options.size() * (ROW_H + ROW_GAP) + 6;
		int boxH = py + ph - boxY - 8;
		if (boxH > 20) {
			ctx.fill(listX(), boxY, listX() + listW(), boxY + boxH, NyxTheme.PANEL_LIGHT);
			ctx.fill(listX(), boxY, listX() + 2, boxY + boxH, NyxTheme.accent());
			if (hovered != null) {
				ctx.text(this.font, hovered.name(), listX() + 8, boxY + 6, NyxTheme.accent(), false);
				List<String> lines = wrap(hovered.description(), listW() - 16);
				for (int i = 0; i < lines.size() && 20 + i * 10 < boxH - 4; i++) {
					ctx.text(this.font, lines.get(i), listX() + 8, boxY + 20 + i * 10, NyxTheme.TEXT_DIM, false);
				}
			} else {
				ctx.text(this.font, "Hover an option to see what it does.", listX() + 8, boxY + 6, NyxTheme.TEXT_DIM, false);
			}
		}

		super.extractRenderState(ctx, mouseX, mouseY, delta);
	}

	/** Plain word-wrap on strings, so no text-component types are involved. */
	private List<String> wrap(String text, int maxWidth) {
		List<String> out = new ArrayList<>();
		StringBuilder line = new StringBuilder();
		for (String word : text.split(" ")) {
			String trial = line.length() == 0 ? word : line + " " + word;
			if (this.font.width(trial) > maxWidth && line.length() > 0) {
				out.add(line.toString());
				line = new StringBuilder(word);
			} else {
				line = new StringBuilder(trial);
			}
		}
		if (line.length() > 0) out.add(line.toString());
		return out;
	}

	private static boolean inside(double mx, double my, int x, int y, int w, int h) {
		return mx >= x && mx < x + w && my >= y && my < y + h;
	}

	// ---- input ----
	@Override
	protected boolean handleClick(double mx, double my, int button) {
		if (button != 0) return false;

		for (int i = 0; i < tabs.size(); i++) {
			if (inside(mx, my, panelX() + 6, panelY() + 28 + i * 24, sideW() - 4, 20)) {
				tabIndex = i;
				return true;
			}
		}
		Tab tab = tabs.get(tabIndex);
		for (int i = 0; i < tab.options.size(); i++) {
			int ry = listY() + i * (ROW_H + ROW_GAP);
			if (inside(mx, my, listX(), ry, listW(), ROW_H)) {
				Opt opt = tab.options.get(i);
				if (opt.isSlider()) {
					dragging = opt;
					opt.click(sliderFraction(mx), false);
				} else {
					opt.click(0f, false);
				}
				return true;
			}
		}
		return false;
	}

	private float sliderFraction(double mx) {
		int sw = Math.min(150, listW() / 2);
		int sx = listX() + listW() - sw - 8;
		return (float) ((mx - sx) / sw);
	}

	@Override
	protected boolean handleDrag(double mx, double my) {
		if (dragging != null) {
			dragging.click(sliderFraction(mx), true);
			return true;
		}
		return false;
	}

	@Override
	protected void handleRelease() {
		dragging = null;
	}

	@Override
	public void onClose() {
		saveAndApply();
		NyxNav.open(this.minecraft, parent);
	}

	@Override
	public void removed() {
		saveAndApply();
	}

	private void saveAndApply() {
		if (!changed) return;
		changed = false;
		Minecraft mc = this.minecraft != null ? this.minecraft : Minecraft.getInstance();
		mc.options.save();
		try {
			NyxNav.refreshVideo(mc);
			
		} catch (Exception ignored) {
			// A failed visual refresh shouldn't cost the player their saved settings.
		}
	}
}
