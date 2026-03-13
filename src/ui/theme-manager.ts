/**
 * Theme Manager for ACP Chat Plugin
 * Handles theme integration with Obsidian's theme system
 */

import { App, Component } from 'obsidian';

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface ThemeConfig {
	mode: ThemeMode;
	respectSystemPreference: boolean;
	customColors?: {
		primary?: string;
		success?: string;
		error?: string;
		warning?: string;
	};
}

export class ThemeManager extends Component {
	private app: App;
	private config: ThemeConfig;
	private currentTheme: 'light' | 'dark' = 'light';
	private observers: Set<(theme: 'light' | 'dark') => void> = new Set();
	private mediaQuery: MediaQueryList;

	constructor(
		app: App,
		config: ThemeConfig = { mode: 'auto', respectSystemPreference: true }
	) {
		super();
		this.app = app;
		this.config = config;
		this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
	}

	onload(): void {
		this.detectCurrentTheme();
		this.setupThemeObserver();
		this.applyTheme();
		this.setupSystemPreferenceListener();
	}

	onunload(): void {
		this.mediaQuery.removeEventListener('change', this.handleSystemThemeChange);
		this.observers.clear();
	}

	/**
	 * Get the current theme
	 */
	getCurrentTheme(): 'light' | 'dark' {
		return this.currentTheme;
	}

	/**
	 * Set theme mode
	 */
	setThemeMode(mode: ThemeMode): void {
		this.config.mode = mode;
		this.detectCurrentTheme();
		this.applyTheme();
		this.notifyObservers();
	}

	/**
	 * Get theme configuration
	 */
	getConfig(): ThemeConfig {
		return { ...this.config };
	}

	/**
	 * Update theme configuration
	 */
	updateConfig(config: Partial<ThemeConfig>): void {
		this.config = { ...this.config, ...config };
		this.detectCurrentTheme();
		this.applyTheme();
		this.notifyObservers();
	}

	/**
	 * Subscribe to theme changes
	 */
	onThemeChange(callback: (theme: 'light' | 'dark') => void): () => void {
		this.observers.add(callback);
		return () => this.observers.delete(callback);
	}

	/**
	 * Get CSS variables for current theme
	 */
	getCSSVariables(): Record<string, string> {
		const baseVars = this.getBaseThemeVariables();
		const customVars = this.getCustomThemeVariables();
		return { ...baseVars, ...customVars };
	}

	/**
	 * Apply theme-specific CSS classes to an element
	 */
	applyThemeClasses(element: HTMLElement): void {
		element.classList.remove('acp-theme-light', 'acp-theme-dark');
		element.classList.add(`acp-theme-${this.currentTheme}`);
	}

	/**
	 * Get theme-aware color value
	 */
	getThemeColor(colorKey: string): string {
		const variables = this.getCSSVariables();
		return variables[colorKey] || this.getComputedCSSVariable(colorKey);
	}

	/**
	 * Check if current theme is dark
	 */
	isDarkTheme(): boolean {
		return this.currentTheme === 'dark';
	}

	/**
	 * Check if current theme is light
	 */
	isLightTheme(): boolean {
		return this.currentTheme === 'light';
	}

	/**
	 * Detect current theme based on configuration and system
	 */
	private detectCurrentTheme(): void {
		let newTheme: 'light' | 'dark';

		switch (this.config.mode) {
			case 'light':
				newTheme = 'light';
				break;
			case 'dark':
				newTheme = 'dark';
				break;
			case 'auto':
			default:
				newTheme = this.detectObsidianTheme();
				break;
		}

		if (newTheme !== this.currentTheme) {
			this.currentTheme = newTheme;
		}
	}

	/**
	 * Detect Obsidian's current theme
	 */
	private detectObsidianTheme(): 'light' | 'dark' {
		// Check Obsidian's theme class on document body
		if (document.body.classList.contains('theme-dark')) {
			return 'dark';
		} else if (document.body.classList.contains('theme-light')) {
			return 'light';
		}

		// Fallback to system preference if Obsidian theme is not detected
		if (this.config.respectSystemPreference) {
			return this.mediaQuery.matches ? 'dark' : 'light';
		}

		// Default to light theme
		return 'light';
	}

	/**
	 * Setup theme observer to watch for Obsidian theme changes
	 */
	private setupThemeObserver(): void {
		// Watch for changes to Obsidian's theme classes
		const observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				if (
					mutation.type === 'attributes' &&
					mutation.attributeName === 'class'
				) {
					const oldTheme = this.currentTheme;
					this.detectCurrentTheme();
					if (oldTheme !== this.currentTheme) {
						this.applyTheme();
						this.notifyObservers();
					}
				}
			});
		});

		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ['class'],
		});

		// Store observer for cleanup
		this.register(() => observer.disconnect());
	}

	/**
	 * Setup system preference listener
	 */
	private setupSystemPreferenceListener(): void {
		this.handleSystemThemeChange = this.handleSystemThemeChange.bind(this);
		this.mediaQuery.addEventListener('change', this.handleSystemThemeChange);
	}

	/**
	 * Handle system theme preference changes
	 */
	private handleSystemThemeChange = (): void => {
		if (this.config.mode === 'auto' && this.config.respectSystemPreference) {
			const oldTheme = this.currentTheme;
			this.detectCurrentTheme();
			if (oldTheme !== this.currentTheme) {
				this.applyTheme();
				this.notifyObservers();
			}
		}
	};

	/**
	 * Apply current theme
	 */
	private applyTheme(): void {
		const root = document.documentElement;
		const variables = this.getCSSVariables();

		// Apply CSS variables
		Object.entries(variables).forEach(([key, value]) => {
			root.style.setProperty(key, value);
		});

		// Apply theme class to body for plugin-specific styling
		document.body.classList.remove('acp-theme-light', 'acp-theme-dark');
		document.body.classList.add(`acp-theme-${this.currentTheme}`);
	}

	/**
	 * Get base theme variables
	 */
	private getBaseThemeVariables(): Record<string, string> {
		const isDark = this.currentTheme === 'dark';
		const bodyStyle = getComputedStyle(document.body);

		// Helper to get property or return a reasonable fallback for common Obsidian variables
		const getProp = (name: string, fallback: string) => {
			const val = bodyStyle.getPropertyValue(name).trim();
			return val || fallback;
		};

		return {
			'--acp-theme-mode': this.currentTheme,
			'--acp-chat-user-bg': isDark
				? 'rgba(var(--color-accent-rgb), 0.1)'
				: 'rgba(var(--color-accent-rgb), 0.05)',
			'--acp-chat-assistant-bg': isDark
				? getProp('--background-secondary', '#1a1a1a')
				: getProp('--background-primary-alt', '#f5f5f5'),
			'--acp-chat-system-bg': isDark
				? getProp('--background-modifier-form-field', '#2a2a2a')
				: getProp('--background-modifier-form-field-highlighted', '#eeeeee'),
			'--acp-status-connected-color': isDark ? '#4ade80' : '#16a34a',
			'--acp-status-disconnected-color': isDark ? '#f87171' : '#dc2626',
			'--acp-input-focus-glow': isDark
				? 'rgba(var(--color-accent-rgb), 0.3)'
				: 'rgba(var(--color-accent-rgb), 0.2)',

			// Map basic text/border tokens to ensures they're available even if CSS :root is late
			'--acp-text-normal': getProp(
				'--text-normal',
				isDark ? '#dcddde' : '#2e3338'
			),
			'--acp-text-muted': getProp(
				'--text-muted',
				isDark ? '#888888' : '#72767d'
			),
			'--acp-text-faint': getProp(
				'--text-faint',
				isDark ? '#4f545c' : '#b9bbbe'
			),
			'--acp-border-color': getProp(
				'--background-modifier-border',
				isDark ? '#303030' : '#e0e0e0'
			),
			'--acp-primary-color': getProp('--color-accent', '#8B5CF6'),

			// Theme Radius Variables
			'--acp-radius-small': getProp('--radius-s', '4px'),
			'--acp-radius-medium': getProp('--radius-m', '8px'),
			'--acp-radius-large': getProp('--radius-l', '12px'),

			// Font Tokens
			'--acp-font-text': getProp('--font-text', 'var(--font-interface)'),
			'--acp-font-interface': getProp('--font-interface', 'sans-serif'),
			'--acp-font-monospace': getProp('--font-monospace', 'monospace'),
		};
	}

	/**
	 * Get custom theme variables
	 */
	private getCustomThemeVariables(): Record<string, string> {
		const customVars: Record<string, string> = {};

		if (this.config.customColors) {
			const { primary, success, error, warning } = this.config.customColors;

			if (primary) customVars['--acp-primary-color'] = primary;
			if (success) customVars['--acp-success-color'] = success;
			if (error) customVars['--acp-error-color'] = error;
			if (warning) customVars['--acp-warning-color'] = warning;
		}

		return customVars;
	}

	/**
	 * Get computed CSS variable value
	 */
	private getComputedCSSVariable(variableName: string): string {
		return getComputedStyle(document.documentElement)
			.getPropertyValue(variableName)
			.trim();
	}

	/**
	 * Notify theme change observers
	 */
	private notifyObservers(): void {
		this.observers.forEach((callback) => {
			try {
				callback(this.currentTheme);
			} catch (error) {
				console.error('Error in theme change observer:', error);
			}
		});
	}

	/**
	 * Create theme-aware CSS rule
	 */
	static createThemeRule(lightValue: string, darkValue: string): string {
		return `var(--acp-theme-mode) == 'dark' ? ${darkValue} : ${lightValue}`;
	}

	/**
	 * Get system theme preference
	 */
	static getSystemThemePreference(): 'light' | 'dark' {
		return window.matchMedia('(prefers-color-scheme: dark)').matches
			? 'dark'
			: 'light';
	}

	/**
	 * Check if system supports dark mode
	 */
	static supportsSystemTheme(): boolean {
		return (
			window.matchMedia &&
			window.matchMedia('(prefers-color-scheme: dark)').media !== 'not all'
		);
	}
}
