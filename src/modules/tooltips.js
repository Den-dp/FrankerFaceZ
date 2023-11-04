'use strict';

// ============================================================================
// Tooltip Handling
// ============================================================================

import {createElement, sanitize} from 'utilities/dom';
import {has, maybe_call, once} from 'utilities/object';

import Tooltip from 'utilities/tooltip';
import Module from 'utilities/module';
import awaitMD, {getMD} from 'utilities/markdown';
import { DEBUG } from 'src/utilities/constants';

export default class TooltipProvider extends Module {
	constructor(...args) {
		super(...args);
		this.types = {};

		this.inject('i18n');

		this.should_enable = true;

		this.types.json = target => {
			const title = target.dataset.title;
			return [
				title && createElement('strong', null, title),
				createElement('code', {
					className: `block${title ? ' pd-t-05 border-t mg-t-05' : ''}`,
					style: {
						fontFamily: 'monospace',
						textAlign: 'left'
					}
				}, target.dataset.data)
			]
		};

		this.types.child = target => {
			const child = target.querySelector(':scope > .ffz-tooltip-child');
			if ( ! child )
				return null;

			target._ffz_child = child;
			child.remove();
			child.classList.remove('ffz-tooltip-child');
			return child;
		};

		this.types.child.onHide = target => {
			const child = target._ffz_child;
			if ( child ) {
				target._ffz_child = null;
				child.remove();

				if ( ! target.querySelector(':scope > .ffz-tooltip-child') ) {
					child.classList.add('ffz-tooltip-child');
					target.appendChild(child);
				}
			}
		};

		this.types.markdown = (target, tip) => {
			tip.add_class = 'ffz-tooltip--markdown';

			const md = getMD();
			if ( ! md )
				return awaitMD().then(md => md.render(target.dataset.title));

			return md.render(target.dataset.title);
		};

		this.types.text = target => sanitize(target.dataset.title);
		this.types.html = target => target.dataset.title;

		this.onFSChange = this.onFSChange.bind(this);
	}


	getAddonProxy(addon_id, addon, module) {
		if ( ! addon_id )
			return this;

		const overrides = {},
			is_dev = DEBUG || addon?.dev;

		overrides.define = (key, handler) => {
			if ( handler )
				handler.__source = addon_id;

			return this.define(key, handler);
		};

		if ( is_dev )
			overrides.cleanup = () => {
				module.log.warn('[DEV-CHECK] Instead of calling tooltips.cleanup(), you can emit the event "tooltips:cleanup"');
				return this.cleanup();
			};

		return new Proxy(this, {
			get(obj, prop) {
				const thing = overrides[prop];
				if ( thing )
					return thing;
				if ( prop === 'types' && is_dev )
					module.log.warn('[DEV-CHECK] Accessed tooltips.types directly. Please use tooltips.define()');

				return Reflect.get(...arguments);
			}
		});
	}


	onEnable() {
		const container = this.getRoot();

		window.addEventListener('fullscreenchange', this.onFSChange);

		//	is_minimal = false; //container && container.classList.contains('twilight-minimal-root');

		this.container = container;
		this.tip_element = container;
		this.tips = this._createInstance(container);

		this.on(':cleanup', this.cleanup);

		this.on('addon:fully-unload', addon_id => {
			let removed = 0;
			for(const [key, handler] of Object.entries(this.types)) {
				if ( handler?.__source === addon_id ) {
					removed++;
					this.types[key] = undefined;
				}
			}

			if ( removed ) {
				this.log.debug(`Cleaned up ${removed} entries when unloading addon:`, addon_id);
				this.cleanup();
			}
		});
	}


	define(key, handler) {
		this.types[key] = handler;
	}


	getRoot() { // eslint-disable-line class-methods-use-this
		return document.querySelector('.sunlight-root') ||
			//document.querySelector('#root>div') ||
			document.querySelector('#root') ||
			document.querySelector('.clips-root') ||
			document.body;
	}

	_createInstance(container, klass = 'ffz-tooltip', default_type = 'text', tip_container) {
		return new Tooltip(container, klass, {
			html: true,
			i18n: this.i18n,
			live: true,
			check_modifiers: true,
			container: tip_container || container,

			delayHide: this.checkDelayHide.bind(this, default_type),
			delayShow: this.checkDelayShow.bind(this, default_type),
			content: this.process.bind(this, default_type),
			interactive: this.checkInteractive.bind(this, default_type),
			hover_events: this.checkHoverEvents.bind(this, default_type),

			onShow: this.delegateOnShow.bind(this, default_type),
			onHide: this.delegateOnHide.bind(this, default_type),

			popperConfig: this.delegatePopperConfig.bind(this, default_type),
			popper: {
				placement: 'top',
				modifiers: {
					flip: {}
				}
			},

			onHover: (target, tip, event) => {
				this.emit(':hover', target, tip, event)
			},

			onLeave: (target, tip, event) => {
				this.emit(':leave', target, tip, event);
			}
		});
	}


	onFSChange() {
		const tip_element = document.fullscreenElement || this.container;
		if ( tip_element !== this.tip_element ) {
			this.tips.destroy();
			this.tip_element = tip_element;
			this.tips = this._createInstance(tip_element);
		}
	}


	cleanup() {
		this.tips.cleanup();
	}


	delegatePopperConfig(default_type, target, tip, pop_opts) {
		const type = target.dataset.tooltipType || default_type,
			handler = this.types[type];

		if ( target.dataset.tooltipSide )
			pop_opts.placement = target.dataset.tooltipSide;

		if ( handler && handler.popperConfig )
			return handler.popperConfig(target, tip, pop_opts);

		return pop_opts;
	}

	delegateOnShow(default_type, target, tip) {
		const type = target.dataset.tooltipType || default_type,
			handler = this.types[type];

		if ( handler && handler.onShow )
			handler.onShow(target, tip);
	}

	delegateOnHide(default_type, target, tip) {
		const type = target.dataset.tooltipType || default_type,
			handler = this.types[type];

		if ( handler && handler.onHide )
			handler.onHide(target, tip);
	}

	checkDelayShow(default_type, target, tip) {
		const type = target.dataset.tooltipType || default_type,
			handler = this.types[type];

		if ( has(handler, 'delayShow') )
			return maybe_call(handler.delayShow, null, target, tip);

		return 0;
	}

	checkDelayHide(default_type, target, tip) {
		const type = target.dataset.tooltipType || default_type,
			handler = this.types[type];

		if ( has(handler, 'delayHide') )
			return maybe_call(handler.delayHide, null, target, tip);

		return 0;
	}

	checkInteractive(default_type, target, tip) {
		const type = target.dataset.tooltipType || default_type,
			handler = this.types[type];

		if ( has(handler, 'interactive') )
			return maybe_call(handler.interactive, null, target, tip);

		return false;
	}

	checkHoverEvents(default_type, target, tip) {
		const type = target.dataset.tooltipType || default_type,
			handler = this.types[type];

		if ( has(handler, 'hover_events') )
			return maybe_call(handler.hover_events, null, target, tip);

		return false;
	}

	process(default_type, target, tip) {
		const type = target.dataset.tooltipType || default_type || 'text',
			align = target.dataset.tooltipAlign,
			handler = this.types[type];

		if ( align )
			tip.align = align;

		if ( ! handler )
			return [
				createElement('strong', null, 'Unhandled Tooltip Type'),
				createElement('code', {
					className: 'tw-block pd-t-05 border-t mg-t-05',
					style: {
						fontFamily: 'monospace',
						textAlign: 'left'
					}
				}, JSON.stringify(target.dataset, null, 4))
			];

		return handler(target, tip);
	}
}