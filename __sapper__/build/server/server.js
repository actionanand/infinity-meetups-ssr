'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var sirv = _interopDefault(require('sirv'));
var polka = _interopDefault(require('polka'));
var compression = _interopDefault(require('compression'));
var fs = _interopDefault(require('fs'));
var path = _interopDefault(require('path'));
var Stream = _interopDefault(require('stream'));
var http = _interopDefault(require('http'));
var Url = _interopDefault(require('url'));
var https = _interopDefault(require('https'));
var zlib = _interopDefault(require('zlib'));

function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function custom_event(type, detail, bubbles = false) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, bubbles, false, detail);
    return e;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error('Function called outside component initialization');
    return current_component;
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
function afterUpdate(fn) {
    get_current_component().$$.after_update.push(fn);
}
function onDestroy(fn) {
    get_current_component().$$.on_destroy.push(fn);
}
function createEventDispatcher() {
    const component = get_current_component();
    return (type, detail) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail);
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
        }
    };
}
function setContext(key, context) {
    get_current_component().$$.context.set(key, context);
}

// source: https://html.spec.whatwg.org/multipage/indices.html
const boolean_attributes = new Set([
    'allowfullscreen',
    'allowpaymentrequest',
    'async',
    'autofocus',
    'autoplay',
    'checked',
    'controls',
    'default',
    'defer',
    'disabled',
    'formnovalidate',
    'hidden',
    'ismap',
    'loop',
    'multiple',
    'muted',
    'nomodule',
    'novalidate',
    'open',
    'playsinline',
    'readonly',
    'required',
    'reversed',
    'selected'
]);
const escaped = {
    '"': '&quot;',
    "'": '&#39;',
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
};
function escape(html) {
    return String(html).replace(/["'&<>]/g, match => escaped[match]);
}
function each(items, fn) {
    let str = '';
    for (let i = 0; i < items.length; i += 1) {
        str += fn(items[i], i);
    }
    return str;
}
const missing_component = {
    $$render: () => ''
};
function validate_component(component, name) {
    if (!component || !component.$$render) {
        if (name === 'svelte:component')
            name += ' this={...}';
        throw new Error(`<${name}> is not a valid SSR component. You may need to review your build config to ensure that dependencies are compiled, rather than imported as pre-compiled modules`);
    }
    return component;
}
let on_destroy;
function create_ssr_component(fn) {
    function $$render(result, props, bindings, slots, context) {
        const parent_component = current_component;
        const $$ = {
            on_destroy,
            context: new Map(context || (parent_component ? parent_component.$$.context : [])),
            // these will be immediately discarded
            on_mount: [],
            before_update: [],
            after_update: [],
            callbacks: blank_object()
        };
        set_current_component({ $$ });
        const html = fn(result, props, bindings, slots);
        set_current_component(parent_component);
        return html;
    }
    return {
        render: (props = {}, { $$slots = {}, context = new Map() } = {}) => {
            on_destroy = [];
            const result = { title: '', head: '', css: new Set() };
            const html = $$render(result, props, {}, $$slots, context);
            run_all(on_destroy);
            return {
                html,
                css: {
                    code: Array.from(result.css).map(css => css.code).join('\n'),
                    map: null // TODO
                },
                head: result.title + result.head
            };
        },
        $$render
    };
}
function add_attribute(name, value, boolean) {
    if (value == null || (boolean && !value))
        return '';
    return ` ${name}${value === true && boolean_attributes.has(name) ? '' : `=${typeof value === 'string' ? JSON.stringify(escape(value)) : `"${value}"`}`}`;
}

const subscriber_queue = [];
/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = new Set();
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (stop) { // store is ready
                const run_queue = !subscriber_queue.length;
                for (const subscriber of subscribers) {
                    subscriber[1]();
                    subscriber_queue.push(subscriber, value);
                }
                if (run_queue) {
                    for (let i = 0; i < subscriber_queue.length; i += 2) {
                        subscriber_queue[i][0](subscriber_queue[i + 1]);
                    }
                    subscriber_queue.length = 0;
                }
            }
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.add(subscriber);
        if (subscribers.size === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            subscribers.delete(subscriber);
            if (subscribers.size === 0) {
                stop();
                stop = null;
            }
        };
    }
    return { set, update, subscribe };
}

const meetups = writable([]);

const customMeetupStore = {
  subscribe: meetups.subscribe,
  setMeetups: (meetupArray) => {
    meetups.set(meetupArray);
  },
  addMeetup: (meetupData) => {
    const newMeetup = {
      ...meetupData
    };
    meetups.update((items) => {
      return [newMeetup, ...items];
    });
  },
  updateMeetup: (id, meetupData) => {
    meetups.update(items => {
      const indexOfItemToBeEdited = items.findIndex(i => i.id === id);
      const updatedMeetup = {...items[indexOfItemToBeEdited], ...meetupData};
      const updatedMeetups = [...items];
      updatedMeetups[indexOfItemToBeEdited] = updatedMeetup;
      return updatedMeetups;
    });
  },
  deleteMeetup: (id) => {
    meetups.update(items => {
      return items.filter(item => item.id !== id);
    });
  },
  toggleFavorite: (id) => {
    meetups.update((items) => {
      const updatedMeetup = {...items.find(meetUp => meetUp.id === id)};
      updatedMeetup.isFavorite = !updatedMeetup.isFavorite;
      const meetUpIndex = items.findIndex(meetUp => meetUp.id === id);
      const updatedMeetups = [...items];
      updatedMeetups[meetUpIndex] = updatedMeetup;
      return updatedMeetups;
    });
  }
};

/* src/components/UI/Button.svelte generated by Svelte v3.46.3 */

const css = {
	code: "button.svelte-g32zaw,a.svelte-g32zaw{font:inherit;border:1px solid #cf0056;background:#cf0056;padding:0.5rem 1rem;color:white;border-radius:5px;box-shadow:1px 1px 3px rgba(0, 0, 0, 0.26);cursor:pointer;text-decoration:none}button.svelte-g32zaw:focus{outline:none}button.svelte-g32zaw:hover,button.svelte-g32zaw:active,a.svelte-g32zaw:hover,a.svelte-g32zaw:active{background:#e40763;border-color:#e40763;box-shadow:1px 1px 8px rgba(77, 51, 51, 0.26)}button.svelte-g32zaw:disabled,button.svelte-g32zaw:disabled:hover,button.svelte-g32zaw:disabled:active{background:#ccc;border-color:#ccc;color:#959595;box-shadow:none;cursor:not-allowed}.success.svelte-g32zaw{background:#01a129;border-color:#01a129}.success.svelte-g32zaw:hover,.success.svelte-g32zaw:active{background:#1ac745;border-color:#1ac745}.outline.svelte-g32zaw{background:transparent;color:#cf0056;box-shadow:none}.outline.svelte-g32zaw:hover,.outline.svelte-g32zaw:active{background:#ffc7de;box-shadow:none}.outline.svelte-g32zaw:disabled,.outline.svelte-g32zaw:disabled:hover,.outline.svelte-g32zaw:disabled:active{background:transparent;color:#ccc}.outline.success.svelte-g32zaw{border-color:#01a129;color:#01a129}.outline.success.svelte-g32zaw:hover,.outline.success.svelte-g32zaw:active{background:#c2ffd1}",
	map: "{\"version\":3,\"file\":\"Button.svelte\",\"sources\":[\"Button.svelte\"],\"sourcesContent\":[\"<script>\\n  export let type = 'button';\\n  export let href = null;\\n  export let mode = null;\\n  export let color = null;\\n  export let disabled = false;\\n</script>\\n\\n{#if href}\\n  <a href=\\\"{href}\\\"><slot/></a>\\n{:else}\\n  <button class=\\\"{mode} {color}\\\" type=\\\"{type}\\\" on:click {disabled}><slot/></button>\\n{/if}\\n\\n<style>\\n  button,\\n  a {\\n    font: inherit;\\n    border: 1px solid #cf0056;\\n    background: #cf0056;\\n    padding: 0.5rem 1rem;\\n    color: white;\\n    border-radius: 5px;\\n    box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.26);\\n    cursor: pointer;\\n    text-decoration: none;\\n  }\\n\\n  button:focus {\\n    outline: none;\\n  }\\n\\n  button:hover,\\n  button:active,\\n  a:hover,\\n  a:active {\\n    background: #e40763;\\n    border-color: #e40763;\\n    box-shadow: 1px 1px 8px rgba(77, 51, 51, 0.26);\\n  }\\n\\n  button:disabled,\\n  button:disabled:hover,\\n  button:disabled:active {\\n    background: #ccc;\\n    border-color: #ccc;\\n    color: #959595;\\n    box-shadow: none;\\n    cursor: not-allowed;\\n  }\\n\\n  .success {\\n    background: #01a129;\\n    border-color: #01a129;\\n  }\\n\\n  .success:hover,\\n  .success:active {\\n    background: #1ac745;\\n    border-color: #1ac745;\\n  }\\n\\n  .outline {\\n    background: transparent;\\n    color: #cf0056;\\n    box-shadow: none;\\n  }\\n\\n  .outline:hover,\\n  .outline:active {\\n    background: #ffc7de;\\n    box-shadow: none;\\n  }\\n\\n  .outline:disabled,\\n  .outline:disabled:hover,\\n  .outline:disabled:active {\\n    background: transparent;\\n    color: #ccc;\\n  }\\n\\n  .outline.success {\\n    border-color: #01a129;\\n    color: #01a129;\\n  }\\n\\n  .outline.success:hover,\\n  .outline.success:active {\\n    background: #c2ffd1;\\n  }\\n</style>\"],\"names\":[],\"mappings\":\"AAeE,oBAAM,CACN,CAAC,cAAC,CAAC,AACD,IAAI,CAAE,OAAO,CACb,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,OAAO,CACzB,UAAU,CAAE,OAAO,CACnB,OAAO,CAAE,MAAM,CAAC,IAAI,CACpB,KAAK,CAAE,KAAK,CACZ,aAAa,CAAE,GAAG,CAClB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CAC3C,MAAM,CAAE,OAAO,CACf,eAAe,CAAE,IAAI,AACvB,CAAC,AAED,oBAAM,MAAM,AAAC,CAAC,AACZ,OAAO,CAAE,IAAI,AACf,CAAC,AAED,oBAAM,MAAM,CACZ,oBAAM,OAAO,CACb,eAAC,MAAM,CACP,eAAC,OAAO,AAAC,CAAC,AACR,UAAU,CAAE,OAAO,CACnB,YAAY,CAAE,OAAO,CACrB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,EAAE,CAAC,CAAC,EAAE,CAAC,CAAC,EAAE,CAAC,CAAC,IAAI,CAAC,AAChD,CAAC,AAED,oBAAM,SAAS,CACf,oBAAM,SAAS,MAAM,CACrB,oBAAM,SAAS,OAAO,AAAC,CAAC,AACtB,UAAU,CAAE,IAAI,CAChB,YAAY,CAAE,IAAI,CAClB,KAAK,CAAE,OAAO,CACd,UAAU,CAAE,IAAI,CAChB,MAAM,CAAE,WAAW,AACrB,CAAC,AAED,QAAQ,cAAC,CAAC,AACR,UAAU,CAAE,OAAO,CACnB,YAAY,CAAE,OAAO,AACvB,CAAC,AAED,sBAAQ,MAAM,CACd,sBAAQ,OAAO,AAAC,CAAC,AACf,UAAU,CAAE,OAAO,CACnB,YAAY,CAAE,OAAO,AACvB,CAAC,AAED,QAAQ,cAAC,CAAC,AACR,UAAU,CAAE,WAAW,CACvB,KAAK,CAAE,OAAO,CACd,UAAU,CAAE,IAAI,AAClB,CAAC,AAED,sBAAQ,MAAM,CACd,sBAAQ,OAAO,AAAC,CAAC,AACf,UAAU,CAAE,OAAO,CACnB,UAAU,CAAE,IAAI,AAClB,CAAC,AAED,sBAAQ,SAAS,CACjB,sBAAQ,SAAS,MAAM,CACvB,sBAAQ,SAAS,OAAO,AAAC,CAAC,AACxB,UAAU,CAAE,WAAW,CACvB,KAAK,CAAE,IAAI,AACb,CAAC,AAED,QAAQ,QAAQ,cAAC,CAAC,AAChB,YAAY,CAAE,OAAO,CACrB,KAAK,CAAE,OAAO,AAChB,CAAC,AAED,QAAQ,sBAAQ,MAAM,CACtB,QAAQ,sBAAQ,OAAO,AAAC,CAAC,AACvB,UAAU,CAAE,OAAO,AACrB,CAAC\"}"
};

const Button = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { type = 'button' } = $$props;
	let { href = null } = $$props;
	let { mode = null } = $$props;
	let { color = null } = $$props;
	let { disabled = false } = $$props;
	if ($$props.type === void 0 && $$bindings.type && type !== void 0) $$bindings.type(type);
	if ($$props.href === void 0 && $$bindings.href && href !== void 0) $$bindings.href(href);
	if ($$props.mode === void 0 && $$bindings.mode && mode !== void 0) $$bindings.mode(mode);
	if ($$props.color === void 0 && $$bindings.color && color !== void 0) $$bindings.color(color);
	if ($$props.disabled === void 0 && $$bindings.disabled && disabled !== void 0) $$bindings.disabled(disabled);
	$$result.css.add(css);

	return `${href
	? `<a${add_attribute("href", href, 0)} class="${"svelte-g32zaw"}">${slots.default ? slots.default({}) : ``}</a>`
	: `<button class="${escape(mode) + " " + escape(color) + " svelte-g32zaw"}"${add_attribute("type", type, 0)} ${disabled ? "disabled" : ""}>${slots.default ? slots.default({}) : ``}</button>`}`;
});

/* src/components/UI/Badge.svelte generated by Svelte v3.46.3 */

const css$1 = {
	code: "span.svelte-1yf4dvc{display:inline-block;margin:0 .25rem;border-radius:3px;border:1px solid #cf0056;background:#cf0056;color:white;padding:0 .5rem;font-family:'Lato', sans-serif;font-size:.8rem}",
	map: "{\"version\":3,\"file\":\"Badge.svelte\",\"sources\":[\"Badge.svelte\"],\"sourcesContent\":[\"<script>\\n  import { slide } from 'svelte/transition';\\n</script>\\n\\n<style>\\n  span {\\n    display: inline-block;\\n    margin: 0 .25rem;\\n    border-radius: 3px;\\n    border: 1px solid #cf0056;\\n    background: #cf0056;\\n    color: white;\\n    padding: 0 .5rem;\\n    font-family: 'Lato', sans-serif;\\n    font-size: .8rem;\\n  }\\n</style>\\n\\n<span transition:slide><slot/></span>\"],\"names\":[],\"mappings\":\"AAKE,IAAI,eAAC,CAAC,AACJ,OAAO,CAAE,YAAY,CACrB,MAAM,CAAE,CAAC,CAAC,MAAM,CAChB,aAAa,CAAE,GAAG,CAClB,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,OAAO,CACzB,UAAU,CAAE,OAAO,CACnB,KAAK,CAAE,KAAK,CACZ,OAAO,CAAE,CAAC,CAAC,KAAK,CAChB,WAAW,CAAE,MAAM,CAAC,CAAC,UAAU,CAC/B,SAAS,CAAE,KAAK,AAClB,CAAC\"}"
};

const Badge = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	$$result.css.add(css$1);
	return `<span class="${"svelte-1yf4dvc"}">${slots.default ? slots.default({}) : ``}</span>`;
});

/* src/components/Meetup/MeetupItem.svelte generated by Svelte v3.46.3 */

const css$2 = {
	code: "article.svelte-1iv6m0p.svelte-1iv6m0p{box-shadow:0 2px 8px rgba(0, 0, 0, 0.26);border-radius:5px;background:white;margin:1rem}header.svelte-1iv6m0p.svelte-1iv6m0p,.content.svelte-1iv6m0p.svelte-1iv6m0p,footer.svelte-1iv6m0p.svelte-1iv6m0p{padding:1rem}.image.svelte-1iv6m0p.svelte-1iv6m0p{width:100%;height:14rem}.image.svelte-1iv6m0p img.svelte-1iv6m0p{width:100%;height:100%;object-fit:cover}h1.svelte-1iv6m0p.svelte-1iv6m0p{font-size:1.25rem;margin:0.5rem 0;font-family:\"Roboto Slab\", sans-serif}h2.svelte-1iv6m0p.svelte-1iv6m0p{font-size:1rem;color:#808080;margin:0.5rem 0}p.svelte-1iv6m0p.svelte-1iv6m0p{font-size:1.25rem;margin:0}div.svelte-1iv6m0p.svelte-1iv6m0p{text-align:right}.changing-fav.svelte-1iv6m0p.svelte-1iv6m0p{font:inherit;border:1px solid #cf0056;background:#cf0056;padding:0.5rem 1rem;color:white;border-radius:5px;box-shadow:1px 1px 3px rgba(0, 0, 0, 0.26);cursor:progress}",
	map: "{\"version\":3,\"file\":\"MeetupItem.svelte\",\"sources\":[\"MeetupItem.svelte\"],\"sourcesContent\":[\"<script>\\n  import { createEventDispatcher } from 'svelte';\\n\\n  import meetups from '../../store/meetups-store.js';\\n\\n  import Button from '../UI/Button.svelte';\\n  import Badge from '../UI/Badge.svelte';\\n\\n  export let title;\\n  export let subtitle;\\n  export let imageUrl;\\n  export let description;\\n  export let address;\\n  export let email;\\n  export let id;\\n  export let isFav;\\n\\n  let isLoading = false;\\n\\n  const dispatch = createEventDispatcher();\\n\\n  function onToggleFavorite() {\\n    isLoading = true;\\n    fetch(`https://vue-http-exmp-default-rtdb.firebaseio.com/meetups/${id}.json`, {\\n        method: 'PATCH',\\n        body: JSON.stringify({ isFavorite: !isFav}),\\n        headers: {\\n          'Content-Type': 'application/json'\\n        }\\n      }).then(res => {\\n        if(!res.ok) {\\n          throw new Error('Error changing favorite status!');\\n        }\\n        isLoading = false;\\n        meetups.toggleFavorite(id);\\n      }).catch(err => {\\n        isLoading = false;\\n        console.log(err);\\n      });\\n  }\\n</script>\\n\\n<style>\\n  article {\\n    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.26);\\n    border-radius: 5px;\\n    background: white;\\n    margin: 1rem;\\n  }\\n\\n  header,\\n  .content,\\n  footer {\\n    padding: 1rem;\\n  }\\n\\n  .image {\\n    width: 100%;\\n    height: 14rem;\\n  }\\n\\n  .image img {\\n    width: 100%;\\n    height: 100%;\\n    object-fit: cover;\\n  }\\n\\n  h1 {\\n    font-size: 1.25rem;\\n    margin: 0.5rem 0;\\n    font-family: \\\"Roboto Slab\\\", sans-serif;\\n  }\\n\\n  /* h1.is-favorite {\\n    background: #01a129;\\n    color: white;\\n    padding: 0 0.5rem;\\n    border-radius: 5px;\\n  } */\\n\\n  h2 {\\n    font-size: 1rem;\\n    color: #808080;\\n    margin: 0.5rem 0;\\n  }\\n\\n  p {\\n    font-size: 1.25rem;\\n    margin: 0;\\n  }\\n\\n  div {\\n    text-align: right;\\n  }\\n\\n  .changing-fav {\\n    font: inherit;\\n    border: 1px solid #cf0056;\\n    background: #cf0056;\\n    padding: 0.5rem 1rem;\\n    color: white;\\n    border-radius: 5px;\\n    box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.26);\\n    cursor: progress;\\n  }\\n</style>\\n\\n<article>\\n  <header>\\n    <h1>\\n      {title} \\n      {#if isFav}\\n        <Badge>Favorite</Badge>\\n      {/if}\\n    </h1>\\n    <h2>{subtitle}</h2>\\n    <p>{address}</p>\\n  </header>\\n  <div class=\\\"image\\\">\\n    <img src=\\\"{imageUrl}\\\" alt=\\\"{title}\\\">\\n  </div>\\n  <div class=\\\"content\\\">\\n    <p>{description}</p>\\n  </div>\\n  <footer>\\n    <!-- <Button href=\\\"mailto:{email}\\\">Contact</Button> -->\\n    <Button mode=\\\"outline\\\" type=\\\"button\\\" on:click=\\\"{dispatch('edit-meetup', id)}\\\">Edit</Button>\\n    {#if isLoading}\\n      <span class=\\\"changing-fav\\\">{isFav? 'Unfavoriting' : 'Favoriting' }...</span>\\n    {:else}\\n      <Button \\n        type=\\\"button\\\" \\n        mode=\\\"outline\\\" \\n        color={isFav? null : 'success'}\\n        on:click=\\\"{onToggleFavorite}\\\">\\n        {isFav? 'Unfavorite' : 'Favorite'}\\n      </Button>\\n    {/if}\\n    <Button href=\\\"/{id}\\\" >Show Details</Button>\\n  </footer>\\n</article>\"],\"names\":[],\"mappings\":\"AA2CE,OAAO,8BAAC,CAAC,AACP,UAAU,CAAE,CAAC,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CACzC,aAAa,CAAE,GAAG,CAClB,UAAU,CAAE,KAAK,CACjB,MAAM,CAAE,IAAI,AACd,CAAC,AAED,oCAAM,CACN,sCAAQ,CACR,MAAM,8BAAC,CAAC,AACN,OAAO,CAAE,IAAI,AACf,CAAC,AAED,MAAM,8BAAC,CAAC,AACN,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,KAAK,AACf,CAAC,AAED,qBAAM,CAAC,GAAG,eAAC,CAAC,AACV,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,CACZ,UAAU,CAAE,KAAK,AACnB,CAAC,AAED,EAAE,8BAAC,CAAC,AACF,SAAS,CAAE,OAAO,CAClB,MAAM,CAAE,MAAM,CAAC,CAAC,CAChB,WAAW,CAAE,aAAa,CAAC,CAAC,UAAU,AACxC,CAAC,AASD,EAAE,8BAAC,CAAC,AACF,SAAS,CAAE,IAAI,CACf,KAAK,CAAE,OAAO,CACd,MAAM,CAAE,MAAM,CAAC,CAAC,AAClB,CAAC,AAED,CAAC,8BAAC,CAAC,AACD,SAAS,CAAE,OAAO,CAClB,MAAM,CAAE,CAAC,AACX,CAAC,AAED,GAAG,8BAAC,CAAC,AACH,UAAU,CAAE,KAAK,AACnB,CAAC,AAED,aAAa,8BAAC,CAAC,AACb,IAAI,CAAE,OAAO,CACb,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,OAAO,CACzB,UAAU,CAAE,OAAO,CACnB,OAAO,CAAE,MAAM,CAAC,IAAI,CACpB,KAAK,CAAE,KAAK,CACZ,aAAa,CAAE,GAAG,CAClB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CAC3C,MAAM,CAAE,QAAQ,AAClB,CAAC\"}"
};

const MeetupItem = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { title } = $$props;
	let { subtitle } = $$props;
	let { imageUrl } = $$props;
	let { description } = $$props;
	let { address } = $$props;
	let { email } = $$props;
	let { id } = $$props;
	let { isFav } = $$props;
	const dispatch = createEventDispatcher();

	if ($$props.title === void 0 && $$bindings.title && title !== void 0) $$bindings.title(title);
	if ($$props.subtitle === void 0 && $$bindings.subtitle && subtitle !== void 0) $$bindings.subtitle(subtitle);
	if ($$props.imageUrl === void 0 && $$bindings.imageUrl && imageUrl !== void 0) $$bindings.imageUrl(imageUrl);
	if ($$props.description === void 0 && $$bindings.description && description !== void 0) $$bindings.description(description);
	if ($$props.address === void 0 && $$bindings.address && address !== void 0) $$bindings.address(address);
	if ($$props.email === void 0 && $$bindings.email && email !== void 0) $$bindings.email(email);
	if ($$props.id === void 0 && $$bindings.id && id !== void 0) $$bindings.id(id);
	if ($$props.isFav === void 0 && $$bindings.isFav && isFav !== void 0) $$bindings.isFav(isFav);
	$$result.css.add(css$2);

	return `<article class="${"svelte-1iv6m0p"}"><header class="${"svelte-1iv6m0p"}"><h1 class="${"svelte-1iv6m0p"}">${escape(title)} 
      ${isFav
	? `${validate_component(Badge, "Badge").$$render($$result, {}, {}, {
			default: () => {
				return `Favorite`;
			}
		})}`
	: ``}</h1>
    <h2 class="${"svelte-1iv6m0p"}">${escape(subtitle)}</h2>
    <p class="${"svelte-1iv6m0p"}">${escape(address)}</p></header>
  <div class="${"image svelte-1iv6m0p"}"><img${add_attribute("src", imageUrl, 0)}${add_attribute("alt", title, 0)} class="${"svelte-1iv6m0p"}"></div>
  <div class="${"content svelte-1iv6m0p"}"><p class="${"svelte-1iv6m0p"}">${escape(description)}</p></div>
  <footer class="${"svelte-1iv6m0p"}">
    ${validate_component(Button, "Button").$$render($$result, { mode: "outline", type: "button" }, {}, {
		default: () => {
			return `Edit`;
		}
	})}
    ${ `${validate_component(Button, "Button").$$render(
			$$result,
			{
				type: "button",
				mode: "outline",
				color: isFav ? null : 'success'
			},
			{},
			{
				default: () => {
					return `${escape(isFav ? 'Unfavorite' : 'Favorite')}`;
				}
			}
		)}`}
    ${validate_component(Button, "Button").$$render($$result, { href: "/" + id }, {}, {
		default: () => {
			return `Show Details`;
		}
	})}</footer></article>`;
});

/* src/components/Meetup/MeetupFilter.svelte generated by Svelte v3.46.3 */

const css$3 = {
	code: "div.svelte-wewm0q{font-size:0px}button.svelte-wewm0q{background:#aaaaaa;font:inherit;font-size:1rem;cursor:pointer;border:1px solid #aaaaaa;padding:0.5rem 1rem}button.svelte-wewm0q:focus{outline:none}button.svelte-wewm0q:first-of-type{border-radius:5px 0 0 5px}button.svelte-wewm0q:last-of-type{border-radius:0 5px 5px 0}button.svelte-wewm0q:hover,button.svelte-wewm0q:active,.active.svelte-wewm0q{background:#cf0056;border-color:#cf0056;color:white}",
	map: "{\"version\":3,\"file\":\"MeetupFilter.svelte\",\"sources\":[\"MeetupFilter.svelte\"],\"sourcesContent\":[\"<script>\\n  import { createEventDispatcher } from 'svelte';\\n\\n  const dispatch = createEventDispatcher();\\n\\n  let selectedButton = 'all-meetup';\\n</script>\\n\\n<div>\\n  <button type=\\\"button\\\" class:active=\\\"{selectedButton === 'all-meetup'}\\\"\\n  on:click=\\\"{() => {\\n    selectedButton = 'all-meetup';\\n    dispatch('select-component', 'all-meetup');\\n  }}\\\">All</button>\\n  <button type=\\\"button\\\" class:active=\\\"{selectedButton === 'fav-meetup'}\\\"\\n  on:click=\\\"{() => {\\n    selectedButton = 'fav-meetup';\\n    dispatch('select-component', 'fav-meetup')\\n  }}\\\">Favorite</button>\\n</div>\\n\\n<style>\\n  div {\\n    font-size: 0px;\\n  }\\n\\n  button {\\n    background: #aaaaaa;\\n    font: inherit;\\n    font-size: 1rem;\\n    cursor: pointer;\\n    border: 1px solid #aaaaaa;\\n    padding: 0.5rem 1rem;\\n  }\\n\\n  button:focus {\\n    outline: none;\\n  }\\n\\n  button:first-of-type {\\n    border-radius: 5px 0 0 5px;\\n  }\\n\\n  button:last-of-type {\\n    border-radius: 0 5px 5px 0;\\n  }\\n\\n  button:hover,\\n  button:active,\\n  .active {\\n    background: #cf0056;\\n    border-color: #cf0056;\\n    color: white;\\n  }\\n</style>\"],\"names\":[],\"mappings\":\"AAsBE,GAAG,cAAC,CAAC,AACH,SAAS,CAAE,GAAG,AAChB,CAAC,AAED,MAAM,cAAC,CAAC,AACN,UAAU,CAAE,OAAO,CACnB,IAAI,CAAE,OAAO,CACb,SAAS,CAAE,IAAI,CACf,MAAM,CAAE,OAAO,CACf,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,OAAO,CACzB,OAAO,CAAE,MAAM,CAAC,IAAI,AACtB,CAAC,AAED,oBAAM,MAAM,AAAC,CAAC,AACZ,OAAO,CAAE,IAAI,AACf,CAAC,AAED,oBAAM,cAAc,AAAC,CAAC,AACpB,aAAa,CAAE,GAAG,CAAC,CAAC,CAAC,CAAC,CAAC,GAAG,AAC5B,CAAC,AAED,oBAAM,aAAa,AAAC,CAAC,AACnB,aAAa,CAAE,CAAC,CAAC,GAAG,CAAC,GAAG,CAAC,CAAC,AAC5B,CAAC,AAED,oBAAM,MAAM,CACZ,oBAAM,OAAO,CACb,OAAO,cAAC,CAAC,AACP,UAAU,CAAE,OAAO,CACnB,YAAY,CAAE,OAAO,CACrB,KAAK,CAAE,KAAK,AACd,CAAC\"}"
};

const MeetupFilter = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	const dispatch = createEventDispatcher();
	$$result.css.add(css$3);

	return `<div class="${"svelte-wewm0q"}"><button type="${"button"}" class="${["svelte-wewm0q",  "active" ].join(' ').trim()}">All</button>
  <button type="${"button"}" class="${["svelte-wewm0q",  ""].join(' ').trim()}">Favorite</button>
</div>`;
});

/* src/components/UI/LoadingSpinner.svelte generated by Svelte v3.46.3 */

const css$4 = {
	code: ".loading-spinner.svelte-1j1bhq9.svelte-1j1bhq9{display:flex;justify-content:center;align-items:center;margin:2rem}.lds-facebook.svelte-1j1bhq9.svelte-1j1bhq9{display:inline-block;position:relative;width:80px;height:80px}.lds-facebook.svelte-1j1bhq9 div.svelte-1j1bhq9{display:inline-block;position:absolute;left:8px;width:16px;background:#cf0056;animation:svelte-1j1bhq9-lds-facebook 1.2s cubic-bezier(0, 0.5, 0.5, 1) infinite}.lds-facebook.svelte-1j1bhq9 div.svelte-1j1bhq9:nth-child(1){left:8px;animation-delay:-0.24s}.lds-facebook.svelte-1j1bhq9 div.svelte-1j1bhq9:nth-child(2){left:32px;animation-delay:-0.12s}.lds-facebook.svelte-1j1bhq9 div.svelte-1j1bhq9:nth-child(3){left:56px;animation-delay:0}@keyframes svelte-1j1bhq9-lds-facebook{0%{top:8px;height:64px}50%,100%{top:24px;height:32px}}",
	map: "{\"version\":3,\"file\":\"LoadingSpinner.svelte\",\"sources\":[\"LoadingSpinner.svelte\"],\"sourcesContent\":[\"<div class=\\\"loading-spinner\\\">\\n  <div class=\\\"lds-facebook\\\"><div></div><div></div><div></div></div>\\n</div>\\n\\n<style>\\n  .loading-spinner {\\n    display: flex;\\n    justify-content: center;\\n    align-items: center;\\n    margin: 2rem;\\n    /* height: 100vh; */\\n  }\\n\\n  .lds-facebook {\\n    display: inline-block;\\n    position: relative;\\n    width: 80px;\\n    height: 80px;\\n  }\\n  .lds-facebook div {\\n    display: inline-block;\\n    position: absolute;\\n    left: 8px;\\n    width: 16px;\\n    background: #cf0056;\\n    animation: lds-facebook 1.2s cubic-bezier(0, 0.5, 0.5, 1) infinite;\\n  }\\n  .lds-facebook div:nth-child(1) {\\n    left: 8px;\\n    animation-delay: -0.24s;\\n  }\\n  .lds-facebook div:nth-child(2) {\\n    left: 32px;\\n    animation-delay: -0.12s;\\n  }\\n  .lds-facebook div:nth-child(3) {\\n    left: 56px;\\n    animation-delay: 0;\\n  }\\n  @keyframes lds-facebook {\\n    0% {\\n      top: 8px;\\n      height: 64px;\\n    }\\n    50%, 100% {\\n      top: 24px;\\n      height: 32px;\\n    }\\n  }\\n</style>\"],\"names\":[],\"mappings\":\"AAKE,gBAAgB,8BAAC,CAAC,AAChB,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,MAAM,CACvB,WAAW,CAAE,MAAM,CACnB,MAAM,CAAE,IAAI,AAEd,CAAC,AAED,aAAa,8BAAC,CAAC,AACb,OAAO,CAAE,YAAY,CACrB,QAAQ,CAAE,QAAQ,CAClB,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,AACd,CAAC,AACD,4BAAa,CAAC,GAAG,eAAC,CAAC,AACjB,OAAO,CAAE,YAAY,CACrB,QAAQ,CAAE,QAAQ,CAClB,IAAI,CAAE,GAAG,CACT,KAAK,CAAE,IAAI,CACX,UAAU,CAAE,OAAO,CACnB,SAAS,CAAE,2BAAY,CAAC,IAAI,CAAC,aAAa,CAAC,CAAC,CAAC,GAAG,CAAC,CAAC,GAAG,CAAC,CAAC,CAAC,CAAC,CAAC,QAAQ,AACpE,CAAC,AACD,4BAAa,CAAC,kBAAG,WAAW,CAAC,CAAC,AAAC,CAAC,AAC9B,IAAI,CAAE,GAAG,CACT,eAAe,CAAE,MAAM,AACzB,CAAC,AACD,4BAAa,CAAC,kBAAG,WAAW,CAAC,CAAC,AAAC,CAAC,AAC9B,IAAI,CAAE,IAAI,CACV,MAAM,SAAS,CAAE,MAAM,AACzB,CAAC,AACD,4BAAa,CAAC,kBAAG,WAAW,CAAC,CAAC,AAAC,CAAC,AAC9B,IAAI,CAAE,IAAI,CACV,KAAK,UAAU,CAAE,CAAC,AACpB,CAAC,AACD,WAAW,2BAAa,CAAC,AACvB,EAAE,AAAC,CAAC,AACF,GAAG,CAAE,GAAG,CACR,MAAM,CAAE,IAAI,AACd,CAAC,AACD,GAAG,CAAE,IAAI,AAAC,CAAC,AACT,GAAG,CAAE,IAAI,CACT,MAAM,CAAE,IAAI,AACd,CAAC,AACH,CAAC\"}"
};

const LoadingSpinner = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	$$result.css.add(css$4);

	return `<div class="${"loading-spinner svelte-1j1bhq9"}"><div class="${"lds-facebook svelte-1j1bhq9"}"><div class="${"svelte-1j1bhq9"}"></div><div class="${"svelte-1j1bhq9"}"></div><div class="${"svelte-1j1bhq9"}"></div></div>
</div>`;
});

/* src/routes/index.svelte generated by Svelte v3.46.3 */

const css$5 = {
	code: "#meetups.svelte-18e9u1f{width:100%;display:grid;grid-template-columns:1fr;grid-gap:1rem}#meetup-controls.svelte-18e9u1f{margin:1rem;display:flex;justify-content:space-between}#no-meetups.svelte-18e9u1f{margin:1rem}@media(min-width: 768px){#meetups.svelte-18e9u1f{grid-template-columns:repeat(2, 1fr)}}",
	map: "{\"version\":3,\"file\":\"index.svelte\",\"sources\":[\"index.svelte\"],\"sourcesContent\":[\"<script context=\\\"module\\\">\\n  export function preload(page) {\\n    // console.log(page);\\n    return this.fetch('https://vue-http-exmp-default-rtdb.firebaseio.com/meetups.json').then(res => {\\n      if(!res.ok) {\\n        throw new Error('Error fetching meetup data');\\n      }\\n      return res.json();\\n    }).then(data => {\\n      const loadedMeetups = [];\\n      for (const key in data) {\\n        loadedMeetups.push({\\n          ...data[key],\\n          id: key\\n        });\\n      }\\n      return {fetchedMeetups: loadedMeetups.reverse()};\\n    }).catch(err => {\\n      this.error(500, 'Could not fetch meetups : ', err.message);\\n    });\\n  }\\n</script>\\n\\n<script>\\n  import { createEventDispatcher, onMount, onDestroy } from 'svelte';\\n  import { scale } from 'svelte/transition';\\n  import { flip } from 'svelte/animate';\\n\\n  import meetups from '../store/meetups-store.js';\\n\\n  import MeetupItem from '../components/Meetup/MeetupItem.svelte';\\n  import MeetupFilter from '../components/Meetup/MeetupFilter.svelte';\\n  import Button from '../components/UI/Button.svelte';\\n  import EditMeetup from '../components/Meetup/EditMeetup.svelte';\\n  import LoadingSpinner from '../components/UI/LoadingSpinner.svelte';\\n\\n  export let fetchedMeetups;\\n\\n\\n  let loadedMeetups = [];\\n  let favsOnly = false;\\n  let editMode;\\n  let editedId = null;\\n  let isLoading = false;\\n  let unsubscribe;\\n\\n  onMount(() => {\\n    isLoading = true;\\n    unsubscribe = meetups.subscribe(items => {\\n      loadedMeetups = items;\\n    });\\n    isLoading = false;\\n    meetups.setMeetups(fetchedMeetups);\\n  });\\n\\n  onDestroy(() => {\\n    if(unsubscribe) {\\n      unsubscribe();\\n    }\\n  });\\n\\n  $: filteredMeetups = favsOnly ? loadedMeetups.filter(m => m.isFavorite) : loadedMeetups;\\n\\n  function selectComponent(event) {\\n    favsOnly = event.detail === 'fav-meetup';\\n  }\\n\\n  function onSaveMeetup() {\\n    editMode = null;\\n    editedId = null;\\n  }\\n\\n  function cancelEdit() {\\n    editMode = null;\\n    editedId = null;\\n  }\\n\\n  function onEditMeetup(event) {\\n    editMode = 'edit';\\n    editedId = event.detail;\\n  }\\n\\n  function onAddMeetup() {\\n    editMode = 'edit';\\n  }\\n\\n  function onErrorEditPage(event) {\\n    isError = {};\\n    isError.message = event.detail;\\n  }\\n</script>\\n\\n<style>\\n  #meetups {\\n    width: 100%;\\n    display: grid;\\n    grid-template-columns: 1fr;\\n    grid-gap: 1rem;\\n  }\\n\\n  #meetup-controls {\\n    margin: 1rem;\\n    display: flex;\\n    justify-content: space-between;\\n  }\\n\\n  #no-meetups {\\n    margin: 1rem;\\n  }\\n\\n  @media (min-width: 768px) {\\n    #meetups {\\n      grid-template-columns: repeat(2, 1fr);\\n    }\\n  }\\n</style>\\n\\n<svelte:head>\\n\\t<title>Infinity Meetups</title>\\n</svelte:head>\\n\\n{#if editMode === 'edit'}\\n  <EditMeetup id={editedId} on:save-form-data={onSaveMeetup} on:cancel=\\\"{cancelEdit}\\\"\\n  on:error-modal=\\\"{onErrorEditPage}\\\" />\\n{/if}\\n\\n{#if isLoading}\\n  <LoadingSpinner/>\\n{:else}\\n  <section id=\\\"meetup-controls\\\">\\n    <MeetupFilter on:select-component=\\\"{selectComponent}\\\" />\\n    <Button on:click=\\\"{onAddMeetup}\\\">New Meetup</Button>\\n  </section>\\n{#if filteredMeetups.length === 0}\\n  <p id=\\\"no-meetups\\\">No meetups found!, Please add some.</p>\\n{/if}\\n  <section id=\\\"meetups\\\">\\n    {#each filteredMeetups as meetup (meetup.id)}\\n      <div transition:scale animate:flip=\\\"{{duration: 700}}\\\">\\n        <MeetupItem title={meetup.title} subtitle={meetup.subtitle} description={meetup.description}\\n        imageUrl={meetup.imageUrl} address={meetup.address} email={meetup.contactEmail} \\n        id={meetup.id} isFav={meetup.isFavorite} on:edit-meetup=\\\"{onEditMeetup}\\\"/>\\n      </div>\\n    {/each}\\n  </section>\\n{/if}\\n\"],\"names\":[],\"mappings\":\"AA6FE,QAAQ,eAAC,CAAC,AACR,KAAK,CAAE,IAAI,CACX,OAAO,CAAE,IAAI,CACb,qBAAqB,CAAE,GAAG,CAC1B,QAAQ,CAAE,IAAI,AAChB,CAAC,AAED,gBAAgB,eAAC,CAAC,AAChB,MAAM,CAAE,IAAI,CACZ,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,aAAa,AAChC,CAAC,AAED,WAAW,eAAC,CAAC,AACX,MAAM,CAAE,IAAI,AACd,CAAC,AAED,MAAM,AAAC,YAAY,KAAK,CAAC,AAAC,CAAC,AACzB,QAAQ,eAAC,CAAC,AACR,qBAAqB,CAAE,OAAO,CAAC,CAAC,CAAC,GAAG,CAAC,AACvC,CAAC,AACH,CAAC\"}"
};

function preload(page) {
	// console.log(page);
	return this.fetch('https://vue-http-exmp-default-rtdb.firebaseio.com/meetups.json').then(res => {
		if (!res.ok) {
			throw new Error('Error fetching meetup data');
		}

		return res.json();
	}).then(data => {
		const loadedMeetups = [];

		for (const key in data) {
			loadedMeetups.push({ ...data[key], id: key });
		}

		return { fetchedMeetups: loadedMeetups.reverse() };
	}).catch(err => {
		this.error(500, 'Could not fetch meetups : ', err.message);
	});
}

const Routes = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let filteredMeetups;
	let { fetchedMeetups } = $$props;
	let loadedMeetups = [];
	let isLoading = false;
	let unsubscribe;

	onMount(() => {
		isLoading = true;

		unsubscribe = customMeetupStore.subscribe(items => {
			loadedMeetups = items;
		});

		isLoading = false;
		customMeetupStore.setMeetups(fetchedMeetups);
	});

	onDestroy(() => {
		if (unsubscribe) {
			unsubscribe();
		}
	});

	if ($$props.fetchedMeetups === void 0 && $$bindings.fetchedMeetups && fetchedMeetups !== void 0) $$bindings.fetchedMeetups(fetchedMeetups);
	$$result.css.add(css$5);

	filteredMeetups =  loadedMeetups;

	return `${($$result.head += `${($$result.title = `<title>Infinity Meetups</title>`, "")}`, "")}

${ ``}

${isLoading
	? `${validate_component(LoadingSpinner, "LoadingSpinner").$$render($$result, {}, {}, {})}`
	: `<section id="${"meetup-controls"}" class="${"svelte-18e9u1f"}">${validate_component(MeetupFilter, "MeetupFilter").$$render($$result, {}, {}, {})}
    ${validate_component(Button, "Button").$$render($$result, {}, {}, {
			default: () => {
				return `New Meetup`;
			}
		})}</section>
${filteredMeetups.length === 0
		? `<p id="${"no-meetups"}" class="${"svelte-18e9u1f"}">No meetups found!, Please add some.</p>`
		: ``}
  <section id="${"meetups"}" class="${"svelte-18e9u1f"}">${each(filteredMeetups, meetup => {
			return `<div>${validate_component(MeetupItem, "MeetupItem").$$render(
				$$result,
				{
					title: meetup.title,
					subtitle: meetup.subtitle,
					description: meetup.description,
					imageUrl: meetup.imageUrl,
					address: meetup.address,
					email: meetup.contactEmail,
					id: meetup.id,
					isFav: meetup.isFavorite
				},
				{},
				{}
			)}
      </div>`;
		})}</section>`}`;
});

/* src/routes/[id].svelte generated by Svelte v3.46.3 */

const css$6 = {
	code: "section.svelte-8ez2ph{margin-top:4rem}.image.svelte-8ez2ph{width:100%;height:25rem}img.svelte-8ez2ph{width:100%;height:100%;object-fit:cover}.image.svelte-8ez2ph{background:#e7e7e7}.content.svelte-8ez2ph{text-align:center;width:80%;margin:auto}h1.svelte-8ez2ph{font-size:2rem;font-family:'Roboto Slab', sans-serif;margin:0.5rem 0}h2.svelte-8ez2ph{font-size:1.25rem;color:#6b6b6b}p.svelte-8ez2ph{font-size:1.5rem}",
	map: "{\"version\":3,\"file\":\"[id].svelte\",\"sources\":[\"[id].svelte\"],\"sourcesContent\":[\"<script context=\\\"module\\\">\\n  export function preload(page) {\\n    const meetupId = page.params.id;\\n\\n    return this.fetch(`https://vue-http-exmp-default-rtdb.firebaseio.com/meetups/${meetupId}.json`)\\n    .then(res => {\\n      if(!res.ok) {\\n        throw new Error(`Error fetching meetup with id ${meetupId}`);\\n      }\\n      return res.json();\\n    }).then(data => {\\n      return {selectedMeetup: {...data, id: meetupId}};\\n      // meetups.setMeetups(loadedMeetups.reverse());\\n    }).catch(err => {\\n      this.error(404, 'Could not fetch meetups');\\n    });\\n  }\\n</script>\\n\\n<script>\\n  import Button from '../components/UI/Button.svelte'\\n\\n  export let selectedMeetup;\\n</script>\\n\\n<section>\\n  <div class=\\\"image\\\">\\n    <img src=\\\"{selectedMeetup.imageUrl}\\\" alt=\\\"{selectedMeetup.title}\\\">\\n  </div>\\n  <div class=\\\"content\\\">\\n    <h1>{selectedMeetup.title}</h1>\\n    <h2>{selectedMeetup.subtitle} - {selectedMeetup.address}</h2>\\n    <p>{selectedMeetup.description}</p>\\n    <Button href=\\\"mailto:{selectedMeetup.contactEmail}\\\">Contact</Button>\\n    <Button href=\\\"/\\\" mode=\\\"outline\\\">Close</Button>\\n  </div>\\n</section>\\n\\n<style>\\n  section {\\n    margin-top: 4rem;\\n  }\\n\\n  .image {\\n    width: 100%;\\n    height: 25rem;\\n  }\\n\\n  img {\\n    width: 100%;\\n    height: 100%;\\n    object-fit: cover;\\n  }\\n\\n  .image {\\n    background: #e7e7e7;\\n  }\\n\\n  .content {\\n    text-align: center;\\n    width: 80%;\\n    margin: auto;\\n  }\\n\\n  h1 {\\n    font-size: 2rem;\\n    font-family: 'Roboto Slab', sans-serif;\\n    margin: 0.5rem 0;\\n  }\\n\\n  h2 {\\n    font-size: 1.25rem;\\n    color: #6b6b6b;\\n  }\\n\\n  p {\\n    font-size: 1.5rem;\\n  }\\n</style>\"],\"names\":[],\"mappings\":\"AAuCE,OAAO,cAAC,CAAC,AACP,UAAU,CAAE,IAAI,AAClB,CAAC,AAED,MAAM,cAAC,CAAC,AACN,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,KAAK,AACf,CAAC,AAED,GAAG,cAAC,CAAC,AACH,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,CACZ,UAAU,CAAE,KAAK,AACnB,CAAC,AAED,MAAM,cAAC,CAAC,AACN,UAAU,CAAE,OAAO,AACrB,CAAC,AAED,QAAQ,cAAC,CAAC,AACR,UAAU,CAAE,MAAM,CAClB,KAAK,CAAE,GAAG,CACV,MAAM,CAAE,IAAI,AACd,CAAC,AAED,EAAE,cAAC,CAAC,AACF,SAAS,CAAE,IAAI,CACf,WAAW,CAAE,aAAa,CAAC,CAAC,UAAU,CACtC,MAAM,CAAE,MAAM,CAAC,CAAC,AAClB,CAAC,AAED,EAAE,cAAC,CAAC,AACF,SAAS,CAAE,OAAO,CAClB,KAAK,CAAE,OAAO,AAChB,CAAC,AAED,CAAC,cAAC,CAAC,AACD,SAAS,CAAE,MAAM,AACnB,CAAC\"}"
};

function preload$1(page) {
	const meetupId = page.params.id;

	return this.fetch(`https://vue-http-exmp-default-rtdb.firebaseio.com/meetups/${meetupId}.json`).then(res => {
		if (!res.ok) {
			throw new Error(`Error fetching meetup with id ${meetupId}`);
		}

		return res.json();
	}).then(data => {
		return {
			selectedMeetup: { ...data, id: meetupId }
		};
	}).catch(err => {
		this.error(404, 'Could not fetch meetups'); // meetups.setMeetups(loadedMeetups.reverse());
	});
}

const U5Bidu5D = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { selectedMeetup } = $$props;
	if ($$props.selectedMeetup === void 0 && $$bindings.selectedMeetup && selectedMeetup !== void 0) $$bindings.selectedMeetup(selectedMeetup);
	$$result.css.add(css$6);

	return `<section class="${"svelte-8ez2ph"}"><div class="${"image svelte-8ez2ph"}"><img${add_attribute("src", selectedMeetup.imageUrl, 0)}${add_attribute("alt", selectedMeetup.title, 0)} class="${"svelte-8ez2ph"}"></div>
  <div class="${"content svelte-8ez2ph"}"><h1 class="${"svelte-8ez2ph"}">${escape(selectedMeetup.title)}</h1>
    <h2 class="${"svelte-8ez2ph"}">${escape(selectedMeetup.subtitle)} - ${escape(selectedMeetup.address)}</h2>
    <p class="${"svelte-8ez2ph"}">${escape(selectedMeetup.description)}</p>
    ${validate_component(Button, "Button").$$render(
		$$result,
		{
			href: "mailto:" + selectedMeetup.contactEmail
		},
		{},
		{
			default: () => {
				return `Contact`;
			}
		}
	)}
    ${validate_component(Button, "Button").$$render($$result, { href: "/", mode: "outline" }, {}, {
		default: () => {
			return `Close`;
		}
	})}</div>
</section>`;
});

/* src/components/UI/Header.svelte generated by Svelte v3.46.3 */

const css$7 = {
	code: "header.svelte-uon6mm{position:fixed;width:100%;top:0;left:0;height:4rem;background:#cf0056;display:flex;justify-content:center;align-items:center;box-shadow:0 2px 6px rgba(0, 0, 0, 0.26)}h1.svelte-uon6mm{color:white;font-family:\"Roboto Slab\", serif;margin:0}.capitalize-it.svelte-uon6mm{text-transform:capitalize}",
	map: "{\"version\":3,\"file\":\"Header.svelte\",\"sources\":[\"Header.svelte\"],\"sourcesContent\":[\"<script>\\n  export let appName;\\n</script>\\n\\n<style>\\n  header {\\n    position: fixed;\\n    width: 100%;\\n    top: 0;\\n    left: 0;\\n    height: 4rem;\\n    background: #cf0056;\\n    display: flex;\\n    justify-content: center;\\n    align-items: center;\\n    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.26);\\n  }\\n\\n  h1 {\\n    color: white;\\n    font-family: \\\"Roboto Slab\\\", serif;\\n    margin: 0;\\n  }\\n\\n  .capitalize-it {\\n    text-transform: capitalize;\\n  }\\n</style>\\n\\n<header>\\n  <h1 class=\\\"capitalize-it\\\">{appName}</h1>\\n</header>\\n\\n\"],\"names\":[],\"mappings\":\"AAKE,MAAM,cAAC,CAAC,AACN,QAAQ,CAAE,KAAK,CACf,KAAK,CAAE,IAAI,CACX,GAAG,CAAE,CAAC,CACN,IAAI,CAAE,CAAC,CACP,MAAM,CAAE,IAAI,CACZ,UAAU,CAAE,OAAO,CACnB,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,MAAM,CACvB,WAAW,CAAE,MAAM,CACnB,UAAU,CAAE,CAAC,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,AAC3C,CAAC,AAED,EAAE,cAAC,CAAC,AACF,KAAK,CAAE,KAAK,CACZ,WAAW,CAAE,aAAa,CAAC,CAAC,KAAK,CACjC,MAAM,CAAE,CAAC,AACX,CAAC,AAED,cAAc,cAAC,CAAC,AACd,cAAc,CAAE,UAAU,AAC5B,CAAC\"}"
};

const Header = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { appName } = $$props;
	if ($$props.appName === void 0 && $$bindings.appName && appName !== void 0) $$bindings.appName(appName);
	$$result.css.add(css$7);
	return `<header class="${"svelte-uon6mm"}"><h1 class="${"capitalize-it svelte-uon6mm"}">${escape(appName)}</h1></header>`;
});

/* src/routes/_layout.svelte generated by Svelte v3.46.3 */

const css$8 = {
	code: "main.svelte-1r5xu04{margin-top:5rem}",
	map: "{\"version\":3,\"file\":\"_layout.svelte\",\"sources\":[\"_layout.svelte\"],\"sourcesContent\":[\"<script>\\n  import Header from '../components/UI/Header.svelte';\\n\\n\\t// export let segment;\\n\\n  let appName = 'infinity meetups';\\n</script>\\n\\n<style>\\n  main {\\n    margin-top: 5rem;\\n  }\\n</style>\\n\\n<Header {appName} />\\n\\n<main>\\n\\t<slot></slot>\\n</main>\"],\"names\":[],\"mappings\":\"AASE,IAAI,eAAC,CAAC,AACJ,UAAU,CAAE,IAAI,AAClB,CAAC\"}"
};

let appName = 'infinity meetups';

const Layout = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	$$result.css.add(css$8);

	return `${validate_component(Header, "Header").$$render($$result, { appName }, {}, {})}

<main class="${"svelte-1r5xu04"}">${slots.default ? slots.default({}) : ``}</main>`;
});

/* src/routes/_error.svelte generated by Svelte v3.46.3 */

const css$9 = {
	code: "h1.svelte-8od9u6,p.svelte-8od9u6{margin:0 auto}h1.svelte-8od9u6{font-size:2.8em;font-weight:700;margin:0 0 0.5em 0}p.svelte-8od9u6{margin:1em auto}@media(min-width: 480px){h1.svelte-8od9u6{font-size:4em}}",
	map: "{\"version\":3,\"file\":\"_error.svelte\",\"sources\":[\"_error.svelte\"],\"sourcesContent\":[\"<script>\\n\\texport let status;\\n\\texport let error;\\n\\n\\tconst dev = undefined === 'development';\\n</script>\\n\\n<style>\\n\\th1, p {\\n\\t\\tmargin: 0 auto;\\n\\t}\\n\\n\\th1 {\\n\\t\\tfont-size: 2.8em;\\n\\t\\tfont-weight: 700;\\n\\t\\tmargin: 0 0 0.5em 0;\\n\\t}\\n\\n\\tp {\\n\\t\\tmargin: 1em auto;\\n\\t}\\n\\n\\t@media (min-width: 480px) {\\n\\t\\th1 {\\n\\t\\t\\tfont-size: 4em;\\n\\t\\t}\\n\\t}\\n</style>\\n\\n<svelte:head>\\n\\t<title>{status}</title>\\n</svelte:head>\\n\\n<h1>{status}</h1>\\n\\n<p>{error.message}</p>\\n\\n{#if dev && error.stack}\\n\\t<pre>{error.stack}</pre>\\n{/if}\\n\"],\"names\":[],\"mappings\":\"AAQC,gBAAE,CAAE,CAAC,cAAC,CAAC,AACN,MAAM,CAAE,CAAC,CAAC,IAAI,AACf,CAAC,AAED,EAAE,cAAC,CAAC,AACH,SAAS,CAAE,KAAK,CAChB,WAAW,CAAE,GAAG,CAChB,MAAM,CAAE,CAAC,CAAC,CAAC,CAAC,KAAK,CAAC,CAAC,AACpB,CAAC,AAED,CAAC,cAAC,CAAC,AACF,MAAM,CAAE,GAAG,CAAC,IAAI,AACjB,CAAC,AAED,MAAM,AAAC,YAAY,KAAK,CAAC,AAAC,CAAC,AAC1B,EAAE,cAAC,CAAC,AACH,SAAS,CAAE,GAAG,AACf,CAAC,AACF,CAAC\"}"
};

const Error$1 = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { status } = $$props;
	let { error } = $$props;
	if ($$props.status === void 0 && $$bindings.status && status !== void 0) $$bindings.status(status);
	if ($$props.error === void 0 && $$bindings.error && error !== void 0) $$bindings.error(error);
	$$result.css.add(css$9);

	return `${($$result.head += `${($$result.title = `<title>${escape(status)}</title>`, "")}`, "")}

<h1 class="${"svelte-8od9u6"}">${escape(status)}</h1>

<p class="${"svelte-8od9u6"}">${escape(error.message)}</p>

${ ``}`;
});

// This file is generated by Sapper — do not edit it!

const d = decodeURIComponent;

const manifest = {
	server_routes: [
		
	],

	pages: [
		{
			// index.svelte
			pattern: /^\/$/,
			parts: [
				{ name: "index", file: "index.svelte", component: Routes, preload: preload }
			]
		},

		{
			// [id].svelte
			pattern: /^\/([^\/]+?)\/?$/,
			parts: [
				{ name: "$id", file: "[id].svelte", component: U5Bidu5D, preload: preload$1, params: match => ({ id: d(match[1]) }) }
			]
		}
	],

	root: Layout,
	root_preload: () => {},
	error: Error$1
};

const build_dir = "__sapper__/build";

const CONTEXT_KEY = {};

/* src/node_modules/@sapper/internal/App.svelte generated by Svelte v3.46.3 */

const App = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { stores } = $$props;
	let { error } = $$props;
	let { status } = $$props;
	let { segments } = $$props;
	let { level0 } = $$props;
	let { level1 = null } = $$props;
	let { notify } = $$props;
	afterUpdate(notify);
	setContext(CONTEXT_KEY, stores);
	if ($$props.stores === void 0 && $$bindings.stores && stores !== void 0) $$bindings.stores(stores);
	if ($$props.error === void 0 && $$bindings.error && error !== void 0) $$bindings.error(error);
	if ($$props.status === void 0 && $$bindings.status && status !== void 0) $$bindings.status(status);
	if ($$props.segments === void 0 && $$bindings.segments && segments !== void 0) $$bindings.segments(segments);
	if ($$props.level0 === void 0 && $$bindings.level0 && level0 !== void 0) $$bindings.level0(level0);
	if ($$props.level1 === void 0 && $$bindings.level1 && level1 !== void 0) $$bindings.level1(level1);
	if ($$props.notify === void 0 && $$bindings.notify && notify !== void 0) $$bindings.notify(notify);

	return `


${validate_component(Layout, "Layout").$$render($$result, Object.assign({ segment: segments[0] }, level0.props), {}, {
		default: () => {
			return `${error
			? `${validate_component(Error$1, "Error").$$render($$result, { error, status }, {}, {})}`
			: `${validate_component(level1.component || missing_component, "svelte:component").$$render($$result, Object.assign(level1.props), {}, {})}`}`;
		}
	})}`;
});

/**
 * @param typeMap [Object] Map of MIME type -> Array[extensions]
 * @param ...
 */
function Mime() {
  this._types = Object.create(null);
  this._extensions = Object.create(null);

  for (var i = 0; i < arguments.length; i++) {
    this.define(arguments[i]);
  }

  this.define = this.define.bind(this);
  this.getType = this.getType.bind(this);
  this.getExtension = this.getExtension.bind(this);
}

/**
 * Define mimetype -> extension mappings.  Each key is a mime-type that maps
 * to an array of extensions associated with the type.  The first extension is
 * used as the default extension for the type.
 *
 * e.g. mime.define({'audio/ogg', ['oga', 'ogg', 'spx']});
 *
 * If a type declares an extension that has already been defined, an error will
 * be thrown.  To suppress this error and force the extension to be associated
 * with the new type, pass `force`=true.  Alternatively, you may prefix the
 * extension with "*" to map the type to extension, without mapping the
 * extension to the type.
 *
 * e.g. mime.define({'audio/wav', ['wav']}, {'audio/x-wav', ['*wav']});
 *
 *
 * @param map (Object) type definitions
 * @param force (Boolean) if true, force overriding of existing definitions
 */
Mime.prototype.define = function(typeMap, force) {
  for (var type in typeMap) {
    var extensions = typeMap[type].map(function(t) {return t.toLowerCase()});
    type = type.toLowerCase();

    for (var i = 0; i < extensions.length; i++) {
      var ext = extensions[i];

      // '*' prefix = not the preferred type for this extension.  So fixup the
      // extension, and skip it.
      if (ext[0] == '*') {
        continue;
      }

      if (!force && (ext in this._types)) {
        throw new Error(
          'Attempt to change mapping for "' + ext +
          '" extension from "' + this._types[ext] + '" to "' + type +
          '". Pass `force=true` to allow this, otherwise remove "' + ext +
          '" from the list of extensions for "' + type + '".'
        );
      }

      this._types[ext] = type;
    }

    // Use first extension as default
    if (force || !this._extensions[type]) {
      var ext = extensions[0];
      this._extensions[type] = (ext[0] != '*') ? ext : ext.substr(1);
    }
  }
};

/**
 * Lookup a mime type based on extension
 */
Mime.prototype.getType = function(path) {
  path = String(path);
  var last = path.replace(/^.*[/\\]/, '').toLowerCase();
  var ext = last.replace(/^.*\./, '').toLowerCase();

  var hasPath = last.length < path.length;
  var hasDot = ext.length < last.length - 1;

  return (hasDot || !hasPath) && this._types[ext] || null;
};

/**
 * Return file extension associated with a mime type
 */
Mime.prototype.getExtension = function(type) {
  type = /^\s*([^;\s]*)/.test(type) && RegExp.$1;
  return type && this._extensions[type.toLowerCase()] || null;
};

var Mime_1 = Mime;

var standard = {"application/andrew-inset":["ez"],"application/applixware":["aw"],"application/atom+xml":["atom"],"application/atomcat+xml":["atomcat"],"application/atomsvc+xml":["atomsvc"],"application/bdoc":["bdoc"],"application/ccxml+xml":["ccxml"],"application/cdmi-capability":["cdmia"],"application/cdmi-container":["cdmic"],"application/cdmi-domain":["cdmid"],"application/cdmi-object":["cdmio"],"application/cdmi-queue":["cdmiq"],"application/cu-seeme":["cu"],"application/dash+xml":["mpd"],"application/davmount+xml":["davmount"],"application/docbook+xml":["dbk"],"application/dssc+der":["dssc"],"application/dssc+xml":["xdssc"],"application/ecmascript":["ecma","es"],"application/emma+xml":["emma"],"application/epub+zip":["epub"],"application/exi":["exi"],"application/font-tdpfr":["pfr"],"application/geo+json":["geojson"],"application/gml+xml":["gml"],"application/gpx+xml":["gpx"],"application/gxf":["gxf"],"application/gzip":["gz"],"application/hjson":["hjson"],"application/hyperstudio":["stk"],"application/inkml+xml":["ink","inkml"],"application/ipfix":["ipfix"],"application/java-archive":["jar","war","ear"],"application/java-serialized-object":["ser"],"application/java-vm":["class"],"application/javascript":["js","mjs"],"application/json":["json","map"],"application/json5":["json5"],"application/jsonml+json":["jsonml"],"application/ld+json":["jsonld"],"application/lost+xml":["lostxml"],"application/mac-binhex40":["hqx"],"application/mac-compactpro":["cpt"],"application/mads+xml":["mads"],"application/manifest+json":["webmanifest"],"application/marc":["mrc"],"application/marcxml+xml":["mrcx"],"application/mathematica":["ma","nb","mb"],"application/mathml+xml":["mathml"],"application/mbox":["mbox"],"application/mediaservercontrol+xml":["mscml"],"application/metalink+xml":["metalink"],"application/metalink4+xml":["meta4"],"application/mets+xml":["mets"],"application/mods+xml":["mods"],"application/mp21":["m21","mp21"],"application/mp4":["mp4s","m4p"],"application/msword":["doc","dot"],"application/mxf":["mxf"],"application/n-quads":["nq"],"application/n-triples":["nt"],"application/octet-stream":["bin","dms","lrf","mar","so","dist","distz","pkg","bpk","dump","elc","deploy","exe","dll","deb","dmg","iso","img","msi","msp","msm","buffer"],"application/oda":["oda"],"application/oebps-package+xml":["opf"],"application/ogg":["ogx"],"application/omdoc+xml":["omdoc"],"application/onenote":["onetoc","onetoc2","onetmp","onepkg"],"application/oxps":["oxps"],"application/patch-ops-error+xml":["xer"],"application/pdf":["pdf"],"application/pgp-encrypted":["pgp"],"application/pgp-signature":["asc","sig"],"application/pics-rules":["prf"],"application/pkcs10":["p10"],"application/pkcs7-mime":["p7m","p7c"],"application/pkcs7-signature":["p7s"],"application/pkcs8":["p8"],"application/pkix-attr-cert":["ac"],"application/pkix-cert":["cer"],"application/pkix-crl":["crl"],"application/pkix-pkipath":["pkipath"],"application/pkixcmp":["pki"],"application/pls+xml":["pls"],"application/postscript":["ai","eps","ps"],"application/pskc+xml":["pskcxml"],"application/raml+yaml":["raml"],"application/rdf+xml":["rdf","owl"],"application/reginfo+xml":["rif"],"application/relax-ng-compact-syntax":["rnc"],"application/resource-lists+xml":["rl"],"application/resource-lists-diff+xml":["rld"],"application/rls-services+xml":["rs"],"application/rpki-ghostbusters":["gbr"],"application/rpki-manifest":["mft"],"application/rpki-roa":["roa"],"application/rsd+xml":["rsd"],"application/rss+xml":["rss"],"application/rtf":["rtf"],"application/sbml+xml":["sbml"],"application/scvp-cv-request":["scq"],"application/scvp-cv-response":["scs"],"application/scvp-vp-request":["spq"],"application/scvp-vp-response":["spp"],"application/sdp":["sdp"],"application/set-payment-initiation":["setpay"],"application/set-registration-initiation":["setreg"],"application/shf+xml":["shf"],"application/sieve":["siv","sieve"],"application/smil+xml":["smi","smil"],"application/sparql-query":["rq"],"application/sparql-results+xml":["srx"],"application/srgs":["gram"],"application/srgs+xml":["grxml"],"application/sru+xml":["sru"],"application/ssdl+xml":["ssdl"],"application/ssml+xml":["ssml"],"application/tei+xml":["tei","teicorpus"],"application/thraud+xml":["tfi"],"application/timestamped-data":["tsd"],"application/voicexml+xml":["vxml"],"application/wasm":["wasm"],"application/widget":["wgt"],"application/winhlp":["hlp"],"application/wsdl+xml":["wsdl"],"application/wspolicy+xml":["wspolicy"],"application/xaml+xml":["xaml"],"application/xcap-diff+xml":["xdf"],"application/xenc+xml":["xenc"],"application/xhtml+xml":["xhtml","xht"],"application/xml":["xml","xsl","xsd","rng"],"application/xml-dtd":["dtd"],"application/xop+xml":["xop"],"application/xproc+xml":["xpl"],"application/xslt+xml":["xslt"],"application/xspf+xml":["xspf"],"application/xv+xml":["mxml","xhvml","xvml","xvm"],"application/yang":["yang"],"application/yin+xml":["yin"],"application/zip":["zip"],"audio/3gpp":["*3gpp"],"audio/adpcm":["adp"],"audio/basic":["au","snd"],"audio/midi":["mid","midi","kar","rmi"],"audio/mp3":["*mp3"],"audio/mp4":["m4a","mp4a"],"audio/mpeg":["mpga","mp2","mp2a","mp3","m2a","m3a"],"audio/ogg":["oga","ogg","spx"],"audio/s3m":["s3m"],"audio/silk":["sil"],"audio/wav":["wav"],"audio/wave":["*wav"],"audio/webm":["weba"],"audio/xm":["xm"],"font/collection":["ttc"],"font/otf":["otf"],"font/ttf":["ttf"],"font/woff":["woff"],"font/woff2":["woff2"],"image/aces":["exr"],"image/apng":["apng"],"image/bmp":["bmp"],"image/cgm":["cgm"],"image/dicom-rle":["drle"],"image/emf":["emf"],"image/fits":["fits"],"image/g3fax":["g3"],"image/gif":["gif"],"image/heic":["heic"],"image/heic-sequence":["heics"],"image/heif":["heif"],"image/heif-sequence":["heifs"],"image/ief":["ief"],"image/jls":["jls"],"image/jp2":["jp2","jpg2"],"image/jpeg":["jpeg","jpg","jpe"],"image/jpm":["jpm"],"image/jpx":["jpx","jpf"],"image/jxr":["jxr"],"image/ktx":["ktx"],"image/png":["png"],"image/sgi":["sgi"],"image/svg+xml":["svg","svgz"],"image/t38":["t38"],"image/tiff":["tif","tiff"],"image/tiff-fx":["tfx"],"image/webp":["webp"],"image/wmf":["wmf"],"message/disposition-notification":["disposition-notification"],"message/global":["u8msg"],"message/global-delivery-status":["u8dsn"],"message/global-disposition-notification":["u8mdn"],"message/global-headers":["u8hdr"],"message/rfc822":["eml","mime"],"model/3mf":["3mf"],"model/gltf+json":["gltf"],"model/gltf-binary":["glb"],"model/iges":["igs","iges"],"model/mesh":["msh","mesh","silo"],"model/stl":["stl"],"model/vrml":["wrl","vrml"],"model/x3d+binary":["*x3db","x3dbz"],"model/x3d+fastinfoset":["x3db"],"model/x3d+vrml":["*x3dv","x3dvz"],"model/x3d+xml":["x3d","x3dz"],"model/x3d-vrml":["x3dv"],"text/cache-manifest":["appcache","manifest"],"text/calendar":["ics","ifb"],"text/coffeescript":["coffee","litcoffee"],"text/css":["css"],"text/csv":["csv"],"text/html":["html","htm","shtml"],"text/jade":["jade"],"text/jsx":["jsx"],"text/less":["less"],"text/markdown":["markdown","md"],"text/mathml":["mml"],"text/mdx":["mdx"],"text/n3":["n3"],"text/plain":["txt","text","conf","def","list","log","in","ini"],"text/richtext":["rtx"],"text/rtf":["*rtf"],"text/sgml":["sgml","sgm"],"text/shex":["shex"],"text/slim":["slim","slm"],"text/stylus":["stylus","styl"],"text/tab-separated-values":["tsv"],"text/troff":["t","tr","roff","man","me","ms"],"text/turtle":["ttl"],"text/uri-list":["uri","uris","urls"],"text/vcard":["vcard"],"text/vtt":["vtt"],"text/xml":["*xml"],"text/yaml":["yaml","yml"],"video/3gpp":["3gp","3gpp"],"video/3gpp2":["3g2"],"video/h261":["h261"],"video/h263":["h263"],"video/h264":["h264"],"video/jpeg":["jpgv"],"video/jpm":["*jpm","jpgm"],"video/mj2":["mj2","mjp2"],"video/mp2t":["ts"],"video/mp4":["mp4","mp4v","mpg4"],"video/mpeg":["mpeg","mpg","mpe","m1v","m2v"],"video/ogg":["ogv"],"video/quicktime":["qt","mov"],"video/webm":["webm"]};

var lite = new Mime_1(standard);

function get_server_route_handler(routes) {
	async function handle_route(route, req, res, next) {
		req.params = route.params(route.pattern.exec(req.path));

		const method = req.method.toLowerCase();
		// 'delete' cannot be exported from a module because it is a keyword,
		// so check for 'del' instead
		const method_export = method === 'delete' ? 'del' : method;
		const handle_method = route.handlers[method_export];
		if (handle_method) {
			if (process.env.SAPPER_EXPORT) {
				const { write, end, setHeader } = res;
				const chunks = [];
				const headers = {};

				// intercept data so that it can be exported
				res.write = function(chunk) {
					chunks.push(Buffer.from(chunk));
					write.apply(res, arguments);
				};

				res.setHeader = function(name, value) {
					headers[name.toLowerCase()] = value;
					setHeader.apply(res, arguments);
				};

				res.end = function(chunk) {
					if (chunk) chunks.push(Buffer.from(chunk));
					end.apply(res, arguments);

					process.send({
						__sapper__: true,
						event: 'file',
						url: req.url,
						method: req.method,
						status: res.statusCode,
						type: headers['content-type'],
						body: Buffer.concat(chunks).toString()
					});
				};
			}

			const handle_next = (err) => {
				if (err) {
					res.statusCode = 500;
					res.end(err.message);
				} else {
					process.nextTick(next);
				}
			};

			try {
				await handle_method(req, res, handle_next);
			} catch (err) {
				console.error(err);
				handle_next(err);
			}
		} else {
			// no matching handler for method
			process.nextTick(next);
		}
	}

	return function find_route(req, res, next) {
		for (const route of routes) {
			if (route.pattern.test(req.path)) {
				handle_route(route, req, res, next);
				return;
			}
		}

		next();
	};
}

/*!
 * cookie
 * Copyright(c) 2012-2014 Roman Shtylman
 * Copyright(c) 2015 Douglas Christopher Wilson
 * MIT Licensed
 */

/**
 * Module exports.
 * @public
 */

var parse_1 = parse;
var serialize_1 = serialize;

/**
 * Module variables.
 * @private
 */

var decode = decodeURIComponent;
var encode = encodeURIComponent;
var pairSplitRegExp = /; */;

/**
 * RegExp to match field-content in RFC 7230 sec 3.2
 *
 * field-content = field-vchar [ 1*( SP / HTAB ) field-vchar ]
 * field-vchar   = VCHAR / obs-text
 * obs-text      = %x80-FF
 */

var fieldContentRegExp = /^[\u0009\u0020-\u007e\u0080-\u00ff]+$/;

/**
 * Parse a cookie header.
 *
 * Parse the given cookie header string into an object
 * The object has the various cookies as keys(names) => values
 *
 * @param {string} str
 * @param {object} [options]
 * @return {object}
 * @public
 */

function parse(str, options) {
  if (typeof str !== 'string') {
    throw new TypeError('argument str must be a string');
  }

  var obj = {};
  var opt = options || {};
  var pairs = str.split(pairSplitRegExp);
  var dec = opt.decode || decode;

  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i];
    var eq_idx = pair.indexOf('=');

    // skip things that don't look like key=value
    if (eq_idx < 0) {
      continue;
    }

    var key = pair.substr(0, eq_idx).trim();
    var val = pair.substr(++eq_idx, pair.length).trim();

    // quoted values
    if ('"' == val[0]) {
      val = val.slice(1, -1);
    }

    // only assign once
    if (undefined == obj[key]) {
      obj[key] = tryDecode(val, dec);
    }
  }

  return obj;
}

/**
 * Serialize data into a cookie header.
 *
 * Serialize the a name value pair into a cookie string suitable for
 * http headers. An optional options object specified cookie parameters.
 *
 * serialize('foo', 'bar', { httpOnly: true })
 *   => "foo=bar; httpOnly"
 *
 * @param {string} name
 * @param {string} val
 * @param {object} [options]
 * @return {string}
 * @public
 */

function serialize(name, val, options) {
  var opt = options || {};
  var enc = opt.encode || encode;

  if (typeof enc !== 'function') {
    throw new TypeError('option encode is invalid');
  }

  if (!fieldContentRegExp.test(name)) {
    throw new TypeError('argument name is invalid');
  }

  var value = enc(val);

  if (value && !fieldContentRegExp.test(value)) {
    throw new TypeError('argument val is invalid');
  }

  var str = name + '=' + value;

  if (null != opt.maxAge) {
    var maxAge = opt.maxAge - 0;
    if (isNaN(maxAge)) throw new Error('maxAge should be a Number');
    str += '; Max-Age=' + Math.floor(maxAge);
  }

  if (opt.domain) {
    if (!fieldContentRegExp.test(opt.domain)) {
      throw new TypeError('option domain is invalid');
    }

    str += '; Domain=' + opt.domain;
  }

  if (opt.path) {
    if (!fieldContentRegExp.test(opt.path)) {
      throw new TypeError('option path is invalid');
    }

    str += '; Path=' + opt.path;
  }

  if (opt.expires) {
    if (typeof opt.expires.toUTCString !== 'function') {
      throw new TypeError('option expires is invalid');
    }

    str += '; Expires=' + opt.expires.toUTCString();
  }

  if (opt.httpOnly) {
    str += '; HttpOnly';
  }

  if (opt.secure) {
    str += '; Secure';
  }

  if (opt.sameSite) {
    var sameSite = typeof opt.sameSite === 'string'
      ? opt.sameSite.toLowerCase() : opt.sameSite;

    switch (sameSite) {
      case true:
        str += '; SameSite=Strict';
        break;
      case 'lax':
        str += '; SameSite=Lax';
        break;
      case 'strict':
        str += '; SameSite=Strict';
        break;
      case 'none':
        str += '; SameSite=None';
        break;
      default:
        throw new TypeError('option sameSite is invalid');
    }
  }

  return str;
}

/**
 * Try decoding a string using a decoding function.
 *
 * @param {string} str
 * @param {function} decode
 * @private
 */

function tryDecode(str, decode) {
  try {
    return decode(str);
  } catch (e) {
    return str;
  }
}

var cookie = {
	parse: parse_1,
	serialize: serialize_1
};

var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
var unsafeChars = /[<>\b\f\n\r\t\0\u2028\u2029]/g;
var reserved = /^(?:do|if|in|for|int|let|new|try|var|byte|case|char|else|enum|goto|long|this|void|with|await|break|catch|class|const|final|float|short|super|throw|while|yield|delete|double|export|import|native|return|switch|throws|typeof|boolean|default|extends|finally|package|private|abstract|continue|debugger|function|volatile|interface|protected|transient|implements|instanceof|synchronized)$/;
var escaped$1 = {
    '<': '\\u003C',
    '>': '\\u003E',
    '/': '\\u002F',
    '\\': '\\\\',
    '\b': '\\b',
    '\f': '\\f',
    '\n': '\\n',
    '\r': '\\r',
    '\t': '\\t',
    '\0': '\\0',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029'
};
var objectProtoOwnPropertyNames = Object.getOwnPropertyNames(Object.prototype).sort().join('\0');
function devalue(value) {
    var counts = new Map();
    function walk(thing) {
        if (typeof thing === 'function') {
            throw new Error("Cannot stringify a function");
        }
        if (counts.has(thing)) {
            counts.set(thing, counts.get(thing) + 1);
            return;
        }
        counts.set(thing, 1);
        if (!isPrimitive(thing)) {
            var type = getType(thing);
            switch (type) {
                case 'Number':
                case 'String':
                case 'Boolean':
                case 'Date':
                case 'RegExp':
                    return;
                case 'Array':
                    thing.forEach(walk);
                    break;
                case 'Set':
                case 'Map':
                    Array.from(thing).forEach(walk);
                    break;
                default:
                    var proto = Object.getPrototypeOf(thing);
                    if (proto !== Object.prototype &&
                        proto !== null &&
                        Object.getOwnPropertyNames(proto).sort().join('\0') !== objectProtoOwnPropertyNames) {
                        throw new Error("Cannot stringify arbitrary non-POJOs");
                    }
                    if (Object.getOwnPropertySymbols(thing).length > 0) {
                        throw new Error("Cannot stringify POJOs with symbolic keys");
                    }
                    Object.keys(thing).forEach(function (key) { return walk(thing[key]); });
            }
        }
    }
    walk(value);
    var names = new Map();
    Array.from(counts)
        .filter(function (entry) { return entry[1] > 1; })
        .sort(function (a, b) { return b[1] - a[1]; })
        .forEach(function (entry, i) {
        names.set(entry[0], getName(i));
    });
    function stringify(thing) {
        if (names.has(thing)) {
            return names.get(thing);
        }
        if (isPrimitive(thing)) {
            return stringifyPrimitive(thing);
        }
        var type = getType(thing);
        switch (type) {
            case 'Number':
            case 'String':
            case 'Boolean':
                return "Object(" + stringify(thing.valueOf()) + ")";
            case 'RegExp':
                return thing.toString();
            case 'Date':
                return "new Date(" + thing.getTime() + ")";
            case 'Array':
                var members = thing.map(function (v, i) { return i in thing ? stringify(v) : ''; });
                var tail = thing.length === 0 || (thing.length - 1 in thing) ? '' : ',';
                return "[" + members.join(',') + tail + "]";
            case 'Set':
            case 'Map':
                return "new " + type + "([" + Array.from(thing).map(stringify).join(',') + "])";
            default:
                var obj = "{" + Object.keys(thing).map(function (key) { return safeKey(key) + ":" + stringify(thing[key]); }).join(',') + "}";
                var proto = Object.getPrototypeOf(thing);
                if (proto === null) {
                    return Object.keys(thing).length > 0
                        ? "Object.assign(Object.create(null)," + obj + ")"
                        : "Object.create(null)";
                }
                return obj;
        }
    }
    var str = stringify(value);
    if (names.size) {
        var params_1 = [];
        var statements_1 = [];
        var values_1 = [];
        names.forEach(function (name, thing) {
            params_1.push(name);
            if (isPrimitive(thing)) {
                values_1.push(stringifyPrimitive(thing));
                return;
            }
            var type = getType(thing);
            switch (type) {
                case 'Number':
                case 'String':
                case 'Boolean':
                    values_1.push("Object(" + stringify(thing.valueOf()) + ")");
                    break;
                case 'RegExp':
                    values_1.push(thing.toString());
                    break;
                case 'Date':
                    values_1.push("new Date(" + thing.getTime() + ")");
                    break;
                case 'Array':
                    values_1.push("Array(" + thing.length + ")");
                    thing.forEach(function (v, i) {
                        statements_1.push(name + "[" + i + "]=" + stringify(v));
                    });
                    break;
                case 'Set':
                    values_1.push("new Set");
                    statements_1.push(name + "." + Array.from(thing).map(function (v) { return "add(" + stringify(v) + ")"; }).join('.'));
                    break;
                case 'Map':
                    values_1.push("new Map");
                    statements_1.push(name + "." + Array.from(thing).map(function (_a) {
                        var k = _a[0], v = _a[1];
                        return "set(" + stringify(k) + ", " + stringify(v) + ")";
                    }).join('.'));
                    break;
                default:
                    values_1.push(Object.getPrototypeOf(thing) === null ? 'Object.create(null)' : '{}');
                    Object.keys(thing).forEach(function (key) {
                        statements_1.push("" + name + safeProp(key) + "=" + stringify(thing[key]));
                    });
            }
        });
        statements_1.push("return " + str);
        return "(function(" + params_1.join(',') + "){" + statements_1.join(';') + "}(" + values_1.join(',') + "))";
    }
    else {
        return str;
    }
}
function getName(num) {
    var name = '';
    do {
        name = chars[num % chars.length] + name;
        num = ~~(num / chars.length) - 1;
    } while (num >= 0);
    return reserved.test(name) ? name + "_" : name;
}
function isPrimitive(thing) {
    return Object(thing) !== thing;
}
function stringifyPrimitive(thing) {
    if (typeof thing === 'string')
        return stringifyString(thing);
    if (thing === void 0)
        return 'void 0';
    if (thing === 0 && 1 / thing < 0)
        return '-0';
    var str = String(thing);
    if (typeof thing === 'number')
        return str.replace(/^(-)?0\./, '$1.');
    return str;
}
function getType(thing) {
    return Object.prototype.toString.call(thing).slice(8, -1);
}
function escapeUnsafeChar(c) {
    return escaped$1[c] || c;
}
function escapeUnsafeChars(str) {
    return str.replace(unsafeChars, escapeUnsafeChar);
}
function safeKey(key) {
    return /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(key) ? key : escapeUnsafeChars(JSON.stringify(key));
}
function safeProp(key) {
    return /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(key) ? "." + key : "[" + escapeUnsafeChars(JSON.stringify(key)) + "]";
}
function stringifyString(str) {
    var result = '"';
    for (var i = 0; i < str.length; i += 1) {
        var char = str.charAt(i);
        var code = char.charCodeAt(0);
        if (char === '"') {
            result += '\\"';
        }
        else if (char in escaped$1) {
            result += escaped$1[char];
        }
        else if (code >= 0xd800 && code <= 0xdfff) {
            var next = str.charCodeAt(i + 1);
            // If this is the beginning of a [high, low] surrogate pair,
            // add the next two characters, otherwise escape
            if (code <= 0xdbff && (next >= 0xdc00 && next <= 0xdfff)) {
                result += char + str[++i];
            }
            else {
                result += "\\u" + code.toString(16).toUpperCase();
            }
        }
        else {
            result += char;
        }
    }
    result += '"';
    return result;
}

// Based on https://github.com/tmpvar/jsdom/blob/aa85b2abf07766ff7bf5c1f6daafb3726f2f2db5/lib/jsdom/living/blob.js

// fix for "Readable" isn't a named export issue
const Readable = Stream.Readable;

const BUFFER = Symbol('buffer');
const TYPE = Symbol('type');

class Blob {
	constructor() {
		this[TYPE] = '';

		const blobParts = arguments[0];
		const options = arguments[1];

		const buffers = [];
		let size = 0;

		if (blobParts) {
			const a = blobParts;
			const length = Number(a.length);
			for (let i = 0; i < length; i++) {
				const element = a[i];
				let buffer;
				if (element instanceof Buffer) {
					buffer = element;
				} else if (ArrayBuffer.isView(element)) {
					buffer = Buffer.from(element.buffer, element.byteOffset, element.byteLength);
				} else if (element instanceof ArrayBuffer) {
					buffer = Buffer.from(element);
				} else if (element instanceof Blob) {
					buffer = element[BUFFER];
				} else {
					buffer = Buffer.from(typeof element === 'string' ? element : String(element));
				}
				size += buffer.length;
				buffers.push(buffer);
			}
		}

		this[BUFFER] = Buffer.concat(buffers);

		let type = options && options.type !== undefined && String(options.type).toLowerCase();
		if (type && !/[^\u0020-\u007E]/.test(type)) {
			this[TYPE] = type;
		}
	}
	get size() {
		return this[BUFFER].length;
	}
	get type() {
		return this[TYPE];
	}
	text() {
		return Promise.resolve(this[BUFFER].toString());
	}
	arrayBuffer() {
		const buf = this[BUFFER];
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		return Promise.resolve(ab);
	}
	stream() {
		const readable = new Readable();
		readable._read = function () {};
		readable.push(this[BUFFER]);
		readable.push(null);
		return readable;
	}
	toString() {
		return '[object Blob]';
	}
	slice() {
		const size = this.size;

		const start = arguments[0];
		const end = arguments[1];
		let relativeStart, relativeEnd;
		if (start === undefined) {
			relativeStart = 0;
		} else if (start < 0) {
			relativeStart = Math.max(size + start, 0);
		} else {
			relativeStart = Math.min(start, size);
		}
		if (end === undefined) {
			relativeEnd = size;
		} else if (end < 0) {
			relativeEnd = Math.max(size + end, 0);
		} else {
			relativeEnd = Math.min(end, size);
		}
		const span = Math.max(relativeEnd - relativeStart, 0);

		const buffer = this[BUFFER];
		const slicedBuffer = buffer.slice(relativeStart, relativeStart + span);
		const blob = new Blob([], { type: arguments[2] });
		blob[BUFFER] = slicedBuffer;
		return blob;
	}
}

Object.defineProperties(Blob.prototype, {
	size: { enumerable: true },
	type: { enumerable: true },
	slice: { enumerable: true }
});

Object.defineProperty(Blob.prototype, Symbol.toStringTag, {
	value: 'Blob',
	writable: false,
	enumerable: false,
	configurable: true
});

/**
 * fetch-error.js
 *
 * FetchError interface for operational errors
 */

/**
 * Create FetchError instance
 *
 * @param   String      message      Error message for human
 * @param   String      type         Error type for machine
 * @param   String      systemError  For Node.js system error
 * @return  FetchError
 */
function FetchError(message, type, systemError) {
  Error.call(this, message);

  this.message = message;
  this.type = type;

  // when err.type is `system`, err.code contains system error code
  if (systemError) {
    this.code = this.errno = systemError.code;
  }

  // hide custom error implementation details from end-users
  Error.captureStackTrace(this, this.constructor);
}

FetchError.prototype = Object.create(Error.prototype);
FetchError.prototype.constructor = FetchError;
FetchError.prototype.name = 'FetchError';

let convert;
try {
	convert = require('encoding').convert;
} catch (e) {}

const INTERNALS = Symbol('Body internals');

// fix an issue where "PassThrough" isn't a named export for node <10
const PassThrough = Stream.PassThrough;

/**
 * Body mixin
 *
 * Ref: https://fetch.spec.whatwg.org/#body
 *
 * @param   Stream  body  Readable stream
 * @param   Object  opts  Response options
 * @return  Void
 */
function Body(body) {
	var _this = this;

	var _ref = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
	    _ref$size = _ref.size;

	let size = _ref$size === undefined ? 0 : _ref$size;
	var _ref$timeout = _ref.timeout;
	let timeout = _ref$timeout === undefined ? 0 : _ref$timeout;

	if (body == null) {
		// body is undefined or null
		body = null;
	} else if (isURLSearchParams(body)) {
		// body is a URLSearchParams
		body = Buffer.from(body.toString());
	} else if (isBlob(body)) ; else if (Buffer.isBuffer(body)) ; else if (Object.prototype.toString.call(body) === '[object ArrayBuffer]') {
		// body is ArrayBuffer
		body = Buffer.from(body);
	} else if (ArrayBuffer.isView(body)) {
		// body is ArrayBufferView
		body = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
	} else if (body instanceof Stream) ; else {
		// none of the above
		// coerce to string then buffer
		body = Buffer.from(String(body));
	}
	this[INTERNALS] = {
		body,
		disturbed: false,
		error: null
	};
	this.size = size;
	this.timeout = timeout;

	if (body instanceof Stream) {
		body.on('error', function (err) {
			const error = err.name === 'AbortError' ? err : new FetchError(`Invalid response body while trying to fetch ${_this.url}: ${err.message}`, 'system', err);
			_this[INTERNALS].error = error;
		});
	}
}

Body.prototype = {
	get body() {
		return this[INTERNALS].body;
	},

	get bodyUsed() {
		return this[INTERNALS].disturbed;
	},

	/**
  * Decode response as ArrayBuffer
  *
  * @return  Promise
  */
	arrayBuffer() {
		return consumeBody.call(this).then(function (buf) {
			return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		});
	},

	/**
  * Return raw response as Blob
  *
  * @return Promise
  */
	blob() {
		let ct = this.headers && this.headers.get('content-type') || '';
		return consumeBody.call(this).then(function (buf) {
			return Object.assign(
			// Prevent copying
			new Blob([], {
				type: ct.toLowerCase()
			}), {
				[BUFFER]: buf
			});
		});
	},

	/**
  * Decode response as json
  *
  * @return  Promise
  */
	json() {
		var _this2 = this;

		return consumeBody.call(this).then(function (buffer) {
			try {
				return JSON.parse(buffer.toString());
			} catch (err) {
				return Body.Promise.reject(new FetchError(`invalid json response body at ${_this2.url} reason: ${err.message}`, 'invalid-json'));
			}
		});
	},

	/**
  * Decode response as text
  *
  * @return  Promise
  */
	text() {
		return consumeBody.call(this).then(function (buffer) {
			return buffer.toString();
		});
	},

	/**
  * Decode response as buffer (non-spec api)
  *
  * @return  Promise
  */
	buffer() {
		return consumeBody.call(this);
	},

	/**
  * Decode response as text, while automatically detecting the encoding and
  * trying to decode to UTF-8 (non-spec api)
  *
  * @return  Promise
  */
	textConverted() {
		var _this3 = this;

		return consumeBody.call(this).then(function (buffer) {
			return convertBody(buffer, _this3.headers);
		});
	}
};

// In browsers, all properties are enumerable.
Object.defineProperties(Body.prototype, {
	body: { enumerable: true },
	bodyUsed: { enumerable: true },
	arrayBuffer: { enumerable: true },
	blob: { enumerable: true },
	json: { enumerable: true },
	text: { enumerable: true }
});

Body.mixIn = function (proto) {
	for (const name of Object.getOwnPropertyNames(Body.prototype)) {
		// istanbul ignore else: future proof
		if (!(name in proto)) {
			const desc = Object.getOwnPropertyDescriptor(Body.prototype, name);
			Object.defineProperty(proto, name, desc);
		}
	}
};

/**
 * Consume and convert an entire Body to a Buffer.
 *
 * Ref: https://fetch.spec.whatwg.org/#concept-body-consume-body
 *
 * @return  Promise
 */
function consumeBody() {
	var _this4 = this;

	if (this[INTERNALS].disturbed) {
		return Body.Promise.reject(new TypeError(`body used already for: ${this.url}`));
	}

	this[INTERNALS].disturbed = true;

	if (this[INTERNALS].error) {
		return Body.Promise.reject(this[INTERNALS].error);
	}

	let body = this.body;

	// body is null
	if (body === null) {
		return Body.Promise.resolve(Buffer.alloc(0));
	}

	// body is blob
	if (isBlob(body)) {
		body = body.stream();
	}

	// body is buffer
	if (Buffer.isBuffer(body)) {
		return Body.Promise.resolve(body);
	}

	// istanbul ignore if: should never happen
	if (!(body instanceof Stream)) {
		return Body.Promise.resolve(Buffer.alloc(0));
	}

	// body is stream
	// get ready to actually consume the body
	let accum = [];
	let accumBytes = 0;
	let abort = false;

	return new Body.Promise(function (resolve, reject) {
		let resTimeout;

		// allow timeout on slow response body
		if (_this4.timeout) {
			resTimeout = setTimeout(function () {
				abort = true;
				reject(new FetchError(`Response timeout while trying to fetch ${_this4.url} (over ${_this4.timeout}ms)`, 'body-timeout'));
			}, _this4.timeout);
		}

		// handle stream errors
		body.on('error', function (err) {
			if (err.name === 'AbortError') {
				// if the request was aborted, reject with this Error
				abort = true;
				reject(err);
			} else {
				// other errors, such as incorrect content-encoding
				reject(new FetchError(`Invalid response body while trying to fetch ${_this4.url}: ${err.message}`, 'system', err));
			}
		});

		body.on('data', function (chunk) {
			if (abort || chunk === null) {
				return;
			}

			if (_this4.size && accumBytes + chunk.length > _this4.size) {
				abort = true;
				reject(new FetchError(`content size at ${_this4.url} over limit: ${_this4.size}`, 'max-size'));
				return;
			}

			accumBytes += chunk.length;
			accum.push(chunk);
		});

		body.on('end', function () {
			if (abort) {
				return;
			}

			clearTimeout(resTimeout);

			try {
				resolve(Buffer.concat(accum, accumBytes));
			} catch (err) {
				// handle streams that have accumulated too much data (issue #414)
				reject(new FetchError(`Could not create Buffer from response body for ${_this4.url}: ${err.message}`, 'system', err));
			}
		});
	});
}

/**
 * Detect buffer encoding and convert to target encoding
 * ref: http://www.w3.org/TR/2011/WD-html5-20110113/parsing.html#determining-the-character-encoding
 *
 * @param   Buffer  buffer    Incoming buffer
 * @param   String  encoding  Target encoding
 * @return  String
 */
function convertBody(buffer, headers) {
	if (typeof convert !== 'function') {
		throw new Error('The package `encoding` must be installed to use the textConverted() function');
	}

	const ct = headers.get('content-type');
	let charset = 'utf-8';
	let res, str;

	// header
	if (ct) {
		res = /charset=([^;]*)/i.exec(ct);
	}

	// no charset in content type, peek at response body for at most 1024 bytes
	str = buffer.slice(0, 1024).toString();

	// html5
	if (!res && str) {
		res = /<meta.+?charset=(['"])(.+?)\1/i.exec(str);
	}

	// html4
	if (!res && str) {
		res = /<meta[\s]+?http-equiv=(['"])content-type\1[\s]+?content=(['"])(.+?)\2/i.exec(str);

		if (res) {
			res = /charset=(.*)/i.exec(res.pop());
		}
	}

	// xml
	if (!res && str) {
		res = /<\?xml.+?encoding=(['"])(.+?)\1/i.exec(str);
	}

	// found charset
	if (res) {
		charset = res.pop();

		// prevent decode issues when sites use incorrect encoding
		// ref: https://hsivonen.fi/encoding-menu/
		if (charset === 'gb2312' || charset === 'gbk') {
			charset = 'gb18030';
		}
	}

	// turn raw buffers into a single utf-8 buffer
	return convert(buffer, 'UTF-8', charset).toString();
}

/**
 * Detect a URLSearchParams object
 * ref: https://github.com/bitinn/node-fetch/issues/296#issuecomment-307598143
 *
 * @param   Object  obj     Object to detect by type or brand
 * @return  String
 */
function isURLSearchParams(obj) {
	// Duck-typing as a necessary condition.
	if (typeof obj !== 'object' || typeof obj.append !== 'function' || typeof obj.delete !== 'function' || typeof obj.get !== 'function' || typeof obj.getAll !== 'function' || typeof obj.has !== 'function' || typeof obj.set !== 'function') {
		return false;
	}

	// Brand-checking and more duck-typing as optional condition.
	return obj.constructor.name === 'URLSearchParams' || Object.prototype.toString.call(obj) === '[object URLSearchParams]' || typeof obj.sort === 'function';
}

/**
 * Check if `obj` is a W3C `Blob` object (which `File` inherits from)
 * @param  {*} obj
 * @return {boolean}
 */
function isBlob(obj) {
	return typeof obj === 'object' && typeof obj.arrayBuffer === 'function' && typeof obj.type === 'string' && typeof obj.stream === 'function' && typeof obj.constructor === 'function' && typeof obj.constructor.name === 'string' && /^(Blob|File)$/.test(obj.constructor.name) && /^(Blob|File)$/.test(obj[Symbol.toStringTag]);
}

/**
 * Clone body given Res/Req instance
 *
 * @param   Mixed  instance  Response or Request instance
 * @return  Mixed
 */
function clone(instance) {
	let p1, p2;
	let body = instance.body;

	// don't allow cloning a used body
	if (instance.bodyUsed) {
		throw new Error('cannot clone body after it is used');
	}

	// check that body is a stream and not form-data object
	// note: we can't clone the form-data object without having it as a dependency
	if (body instanceof Stream && typeof body.getBoundary !== 'function') {
		// tee instance body
		p1 = new PassThrough();
		p2 = new PassThrough();
		body.pipe(p1);
		body.pipe(p2);
		// set instance body to teed body and return the other teed body
		instance[INTERNALS].body = p1;
		body = p2;
	}

	return body;
}

/**
 * Performs the operation "extract a `Content-Type` value from |object|" as
 * specified in the specification:
 * https://fetch.spec.whatwg.org/#concept-bodyinit-extract
 *
 * This function assumes that instance.body is present.
 *
 * @param   Mixed  instance  Any options.body input
 */
function extractContentType(body) {
	if (body === null) {
		// body is null
		return null;
	} else if (typeof body === 'string') {
		// body is string
		return 'text/plain;charset=UTF-8';
	} else if (isURLSearchParams(body)) {
		// body is a URLSearchParams
		return 'application/x-www-form-urlencoded;charset=UTF-8';
	} else if (isBlob(body)) {
		// body is blob
		return body.type || null;
	} else if (Buffer.isBuffer(body)) {
		// body is buffer
		return null;
	} else if (Object.prototype.toString.call(body) === '[object ArrayBuffer]') {
		// body is ArrayBuffer
		return null;
	} else if (ArrayBuffer.isView(body)) {
		// body is ArrayBufferView
		return null;
	} else if (typeof body.getBoundary === 'function') {
		// detect form data input from form-data module
		return `multipart/form-data;boundary=${body.getBoundary()}`;
	} else if (body instanceof Stream) {
		// body is stream
		// can't really do much about this
		return null;
	} else {
		// Body constructor defaults other things to string
		return 'text/plain;charset=UTF-8';
	}
}

/**
 * The Fetch Standard treats this as if "total bytes" is a property on the body.
 * For us, we have to explicitly get it with a function.
 *
 * ref: https://fetch.spec.whatwg.org/#concept-body-total-bytes
 *
 * @param   Body    instance   Instance of Body
 * @return  Number?            Number of bytes, or null if not possible
 */
function getTotalBytes(instance) {
	const body = instance.body;


	if (body === null) {
		// body is null
		return 0;
	} else if (isBlob(body)) {
		return body.size;
	} else if (Buffer.isBuffer(body)) {
		// body is buffer
		return body.length;
	} else if (body && typeof body.getLengthSync === 'function') {
		// detect form data input from form-data module
		if (body._lengthRetrievers && body._lengthRetrievers.length == 0 || // 1.x
		body.hasKnownLength && body.hasKnownLength()) {
			// 2.x
			return body.getLengthSync();
		}
		return null;
	} else {
		// body is stream
		return null;
	}
}

/**
 * Write a Body to a Node.js WritableStream (e.g. http.Request) object.
 *
 * @param   Body    instance   Instance of Body
 * @return  Void
 */
function writeToStream(dest, instance) {
	const body = instance.body;


	if (body === null) {
		// body is null
		dest.end();
	} else if (isBlob(body)) {
		body.stream().pipe(dest);
	} else if (Buffer.isBuffer(body)) {
		// body is buffer
		dest.write(body);
		dest.end();
	} else {
		// body is stream
		body.pipe(dest);
	}
}

// expose Promise
Body.Promise = global.Promise;

/**
 * headers.js
 *
 * Headers class offers convenient helpers
 */

const invalidTokenRegex = /[^\^_`a-zA-Z\-0-9!#$%&'*+.|~]/;
const invalidHeaderCharRegex = /[^\t\x20-\x7e\x80-\xff]/;

function validateName(name) {
	name = `${name}`;
	if (invalidTokenRegex.test(name) || name === '') {
		throw new TypeError(`${name} is not a legal HTTP header name`);
	}
}

function validateValue(value) {
	value = `${value}`;
	if (invalidHeaderCharRegex.test(value)) {
		throw new TypeError(`${value} is not a legal HTTP header value`);
	}
}

/**
 * Find the key in the map object given a header name.
 *
 * Returns undefined if not found.
 *
 * @param   String  name  Header name
 * @return  String|Undefined
 */
function find(map, name) {
	name = name.toLowerCase();
	for (const key in map) {
		if (key.toLowerCase() === name) {
			return key;
		}
	}
	return undefined;
}

const MAP = Symbol('map');
class Headers {
	/**
  * Headers class
  *
  * @param   Object  headers  Response headers
  * @return  Void
  */
	constructor() {
		let init = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : undefined;

		this[MAP] = Object.create(null);

		if (init instanceof Headers) {
			const rawHeaders = init.raw();
			const headerNames = Object.keys(rawHeaders);

			for (const headerName of headerNames) {
				for (const value of rawHeaders[headerName]) {
					this.append(headerName, value);
				}
			}

			return;
		}

		// We don't worry about converting prop to ByteString here as append()
		// will handle it.
		if (init == null) ; else if (typeof init === 'object') {
			const method = init[Symbol.iterator];
			if (method != null) {
				if (typeof method !== 'function') {
					throw new TypeError('Header pairs must be iterable');
				}

				// sequence<sequence<ByteString>>
				// Note: per spec we have to first exhaust the lists then process them
				const pairs = [];
				for (const pair of init) {
					if (typeof pair !== 'object' || typeof pair[Symbol.iterator] !== 'function') {
						throw new TypeError('Each header pair must be iterable');
					}
					pairs.push(Array.from(pair));
				}

				for (const pair of pairs) {
					if (pair.length !== 2) {
						throw new TypeError('Each header pair must be a name/value tuple');
					}
					this.append(pair[0], pair[1]);
				}
			} else {
				// record<ByteString, ByteString>
				for (const key of Object.keys(init)) {
					const value = init[key];
					this.append(key, value);
				}
			}
		} else {
			throw new TypeError('Provided initializer must be an object');
		}
	}

	/**
  * Return combined header value given name
  *
  * @param   String  name  Header name
  * @return  Mixed
  */
	get(name) {
		name = `${name}`;
		validateName(name);
		const key = find(this[MAP], name);
		if (key === undefined) {
			return null;
		}

		return this[MAP][key].join(', ');
	}

	/**
  * Iterate over all headers
  *
  * @param   Function  callback  Executed for each item with parameters (value, name, thisArg)
  * @param   Boolean   thisArg   `this` context for callback function
  * @return  Void
  */
	forEach(callback) {
		let thisArg = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : undefined;

		let pairs = getHeaders(this);
		let i = 0;
		while (i < pairs.length) {
			var _pairs$i = pairs[i];
			const name = _pairs$i[0],
			      value = _pairs$i[1];

			callback.call(thisArg, value, name, this);
			pairs = getHeaders(this);
			i++;
		}
	}

	/**
  * Overwrite header values given name
  *
  * @param   String  name   Header name
  * @param   String  value  Header value
  * @return  Void
  */
	set(name, value) {
		name = `${name}`;
		value = `${value}`;
		validateName(name);
		validateValue(value);
		const key = find(this[MAP], name);
		this[MAP][key !== undefined ? key : name] = [value];
	}

	/**
  * Append a value onto existing header
  *
  * @param   String  name   Header name
  * @param   String  value  Header value
  * @return  Void
  */
	append(name, value) {
		name = `${name}`;
		value = `${value}`;
		validateName(name);
		validateValue(value);
		const key = find(this[MAP], name);
		if (key !== undefined) {
			this[MAP][key].push(value);
		} else {
			this[MAP][name] = [value];
		}
	}

	/**
  * Check for header name existence
  *
  * @param   String   name  Header name
  * @return  Boolean
  */
	has(name) {
		name = `${name}`;
		validateName(name);
		return find(this[MAP], name) !== undefined;
	}

	/**
  * Delete all header values given name
  *
  * @param   String  name  Header name
  * @return  Void
  */
	delete(name) {
		name = `${name}`;
		validateName(name);
		const key = find(this[MAP], name);
		if (key !== undefined) {
			delete this[MAP][key];
		}
	}

	/**
  * Return raw headers (non-spec api)
  *
  * @return  Object
  */
	raw() {
		return this[MAP];
	}

	/**
  * Get an iterator on keys.
  *
  * @return  Iterator
  */
	keys() {
		return createHeadersIterator(this, 'key');
	}

	/**
  * Get an iterator on values.
  *
  * @return  Iterator
  */
	values() {
		return createHeadersIterator(this, 'value');
	}

	/**
  * Get an iterator on entries.
  *
  * This is the default iterator of the Headers object.
  *
  * @return  Iterator
  */
	[Symbol.iterator]() {
		return createHeadersIterator(this, 'key+value');
	}
}
Headers.prototype.entries = Headers.prototype[Symbol.iterator];

Object.defineProperty(Headers.prototype, Symbol.toStringTag, {
	value: 'Headers',
	writable: false,
	enumerable: false,
	configurable: true
});

Object.defineProperties(Headers.prototype, {
	get: { enumerable: true },
	forEach: { enumerable: true },
	set: { enumerable: true },
	append: { enumerable: true },
	has: { enumerable: true },
	delete: { enumerable: true },
	keys: { enumerable: true },
	values: { enumerable: true },
	entries: { enumerable: true }
});

function getHeaders(headers) {
	let kind = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'key+value';

	const keys = Object.keys(headers[MAP]).sort();
	return keys.map(kind === 'key' ? function (k) {
		return k.toLowerCase();
	} : kind === 'value' ? function (k) {
		return headers[MAP][k].join(', ');
	} : function (k) {
		return [k.toLowerCase(), headers[MAP][k].join(', ')];
	});
}

const INTERNAL = Symbol('internal');

function createHeadersIterator(target, kind) {
	const iterator = Object.create(HeadersIteratorPrototype);
	iterator[INTERNAL] = {
		target,
		kind,
		index: 0
	};
	return iterator;
}

const HeadersIteratorPrototype = Object.setPrototypeOf({
	next() {
		// istanbul ignore if
		if (!this || Object.getPrototypeOf(this) !== HeadersIteratorPrototype) {
			throw new TypeError('Value of `this` is not a HeadersIterator');
		}

		var _INTERNAL = this[INTERNAL];
		const target = _INTERNAL.target,
		      kind = _INTERNAL.kind,
		      index = _INTERNAL.index;

		const values = getHeaders(target, kind);
		const len = values.length;
		if (index >= len) {
			return {
				value: undefined,
				done: true
			};
		}

		this[INTERNAL].index = index + 1;

		return {
			value: values[index],
			done: false
		};
	}
}, Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())));

Object.defineProperty(HeadersIteratorPrototype, Symbol.toStringTag, {
	value: 'HeadersIterator',
	writable: false,
	enumerable: false,
	configurable: true
});

/**
 * Export the Headers object in a form that Node.js can consume.
 *
 * @param   Headers  headers
 * @return  Object
 */
function exportNodeCompatibleHeaders(headers) {
	const obj = Object.assign({ __proto__: null }, headers[MAP]);

	// http.request() only supports string as Host header. This hack makes
	// specifying custom Host header possible.
	const hostHeaderKey = find(headers[MAP], 'Host');
	if (hostHeaderKey !== undefined) {
		obj[hostHeaderKey] = obj[hostHeaderKey][0];
	}

	return obj;
}

/**
 * Create a Headers object from an object of headers, ignoring those that do
 * not conform to HTTP grammar productions.
 *
 * @param   Object  obj  Object of headers
 * @return  Headers
 */
function createHeadersLenient(obj) {
	const headers = new Headers();
	for (const name of Object.keys(obj)) {
		if (invalidTokenRegex.test(name)) {
			continue;
		}
		if (Array.isArray(obj[name])) {
			for (const val of obj[name]) {
				if (invalidHeaderCharRegex.test(val)) {
					continue;
				}
				if (headers[MAP][name] === undefined) {
					headers[MAP][name] = [val];
				} else {
					headers[MAP][name].push(val);
				}
			}
		} else if (!invalidHeaderCharRegex.test(obj[name])) {
			headers[MAP][name] = [obj[name]];
		}
	}
	return headers;
}

const INTERNALS$1 = Symbol('Response internals');

// fix an issue where "STATUS_CODES" aren't a named export for node <10
const STATUS_CODES = http.STATUS_CODES;

/**
 * Response class
 *
 * @param   Stream  body  Readable stream
 * @param   Object  opts  Response options
 * @return  Void
 */
class Response {
	constructor() {
		let body = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
		let opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

		Body.call(this, body, opts);

		const status = opts.status || 200;
		const headers = new Headers(opts.headers);

		if (body != null && !headers.has('Content-Type')) {
			const contentType = extractContentType(body);
			if (contentType) {
				headers.append('Content-Type', contentType);
			}
		}

		this[INTERNALS$1] = {
			url: opts.url,
			status,
			statusText: opts.statusText || STATUS_CODES[status],
			headers,
			counter: opts.counter
		};
	}

	get url() {
		return this[INTERNALS$1].url || '';
	}

	get status() {
		return this[INTERNALS$1].status;
	}

	/**
  * Convenience property representing if the request ended normally
  */
	get ok() {
		return this[INTERNALS$1].status >= 200 && this[INTERNALS$1].status < 300;
	}

	get redirected() {
		return this[INTERNALS$1].counter > 0;
	}

	get statusText() {
		return this[INTERNALS$1].statusText;
	}

	get headers() {
		return this[INTERNALS$1].headers;
	}

	/**
  * Clone this response
  *
  * @return  Response
  */
	clone() {
		return new Response(clone(this), {
			url: this.url,
			status: this.status,
			statusText: this.statusText,
			headers: this.headers,
			ok: this.ok,
			redirected: this.redirected
		});
	}
}

Body.mixIn(Response.prototype);

Object.defineProperties(Response.prototype, {
	url: { enumerable: true },
	status: { enumerable: true },
	ok: { enumerable: true },
	redirected: { enumerable: true },
	statusText: { enumerable: true },
	headers: { enumerable: true },
	clone: { enumerable: true }
});

Object.defineProperty(Response.prototype, Symbol.toStringTag, {
	value: 'Response',
	writable: false,
	enumerable: false,
	configurable: true
});

const INTERNALS$2 = Symbol('Request internals');

// fix an issue where "format", "parse" aren't a named export for node <10
const parse_url = Url.parse;
const format_url = Url.format;

const streamDestructionSupported = 'destroy' in Stream.Readable.prototype;

/**
 * Check if a value is an instance of Request.
 *
 * @param   Mixed   input
 * @return  Boolean
 */
function isRequest(input) {
	return typeof input === 'object' && typeof input[INTERNALS$2] === 'object';
}

function isAbortSignal(signal) {
	const proto = signal && typeof signal === 'object' && Object.getPrototypeOf(signal);
	return !!(proto && proto.constructor.name === 'AbortSignal');
}

/**
 * Request class
 *
 * @param   Mixed   input  Url or Request instance
 * @param   Object  init   Custom options
 * @return  Void
 */
class Request {
	constructor(input) {
		let init = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

		let parsedURL;

		// normalize input
		if (!isRequest(input)) {
			if (input && input.href) {
				// in order to support Node.js' Url objects; though WHATWG's URL objects
				// will fall into this branch also (since their `toString()` will return
				// `href` property anyway)
				parsedURL = parse_url(input.href);
			} else {
				// coerce input to a string before attempting to parse
				parsedURL = parse_url(`${input}`);
			}
			input = {};
		} else {
			parsedURL = parse_url(input.url);
		}

		let method = init.method || input.method || 'GET';
		method = method.toUpperCase();

		if ((init.body != null || isRequest(input) && input.body !== null) && (method === 'GET' || method === 'HEAD')) {
			throw new TypeError('Request with GET/HEAD method cannot have body');
		}

		let inputBody = init.body != null ? init.body : isRequest(input) && input.body !== null ? clone(input) : null;

		Body.call(this, inputBody, {
			timeout: init.timeout || input.timeout || 0,
			size: init.size || input.size || 0
		});

		const headers = new Headers(init.headers || input.headers || {});

		if (inputBody != null && !headers.has('Content-Type')) {
			const contentType = extractContentType(inputBody);
			if (contentType) {
				headers.append('Content-Type', contentType);
			}
		}

		let signal = isRequest(input) ? input.signal : null;
		if ('signal' in init) signal = init.signal;

		if (signal != null && !isAbortSignal(signal)) {
			throw new TypeError('Expected signal to be an instanceof AbortSignal');
		}

		this[INTERNALS$2] = {
			method,
			redirect: init.redirect || input.redirect || 'follow',
			headers,
			parsedURL,
			signal
		};

		// node-fetch-only options
		this.follow = init.follow !== undefined ? init.follow : input.follow !== undefined ? input.follow : 20;
		this.compress = init.compress !== undefined ? init.compress : input.compress !== undefined ? input.compress : true;
		this.counter = init.counter || input.counter || 0;
		this.agent = init.agent || input.agent;
	}

	get method() {
		return this[INTERNALS$2].method;
	}

	get url() {
		return format_url(this[INTERNALS$2].parsedURL);
	}

	get headers() {
		return this[INTERNALS$2].headers;
	}

	get redirect() {
		return this[INTERNALS$2].redirect;
	}

	get signal() {
		return this[INTERNALS$2].signal;
	}

	/**
  * Clone this request
  *
  * @return  Request
  */
	clone() {
		return new Request(this);
	}
}

Body.mixIn(Request.prototype);

Object.defineProperty(Request.prototype, Symbol.toStringTag, {
	value: 'Request',
	writable: false,
	enumerable: false,
	configurable: true
});

Object.defineProperties(Request.prototype, {
	method: { enumerable: true },
	url: { enumerable: true },
	headers: { enumerable: true },
	redirect: { enumerable: true },
	clone: { enumerable: true },
	signal: { enumerable: true }
});

/**
 * Convert a Request to Node.js http request options.
 *
 * @param   Request  A Request instance
 * @return  Object   The options object to be passed to http.request
 */
function getNodeRequestOptions(request) {
	const parsedURL = request[INTERNALS$2].parsedURL;
	const headers = new Headers(request[INTERNALS$2].headers);

	// fetch step 1.3
	if (!headers.has('Accept')) {
		headers.set('Accept', '*/*');
	}

	// Basic fetch
	if (!parsedURL.protocol || !parsedURL.hostname) {
		throw new TypeError('Only absolute URLs are supported');
	}

	if (!/^https?:$/.test(parsedURL.protocol)) {
		throw new TypeError('Only HTTP(S) protocols are supported');
	}

	if (request.signal && request.body instanceof Stream.Readable && !streamDestructionSupported) {
		throw new Error('Cancellation of streamed requests with AbortSignal is not supported in node < 8');
	}

	// HTTP-network-or-cache fetch steps 2.4-2.7
	let contentLengthValue = null;
	if (request.body == null && /^(POST|PUT)$/i.test(request.method)) {
		contentLengthValue = '0';
	}
	if (request.body != null) {
		const totalBytes = getTotalBytes(request);
		if (typeof totalBytes === 'number') {
			contentLengthValue = String(totalBytes);
		}
	}
	if (contentLengthValue) {
		headers.set('Content-Length', contentLengthValue);
	}

	// HTTP-network-or-cache fetch step 2.11
	if (!headers.has('User-Agent')) {
		headers.set('User-Agent', 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)');
	}

	// HTTP-network-or-cache fetch step 2.15
	if (request.compress && !headers.has('Accept-Encoding')) {
		headers.set('Accept-Encoding', 'gzip,deflate');
	}

	let agent = request.agent;
	if (typeof agent === 'function') {
		agent = agent(parsedURL);
	}

	if (!headers.has('Connection') && !agent) {
		headers.set('Connection', 'close');
	}

	// HTTP-network fetch step 4.2
	// chunked encoding is handled by Node.js

	return Object.assign({}, parsedURL, {
		method: request.method,
		headers: exportNodeCompatibleHeaders(headers),
		agent
	});
}

/**
 * abort-error.js
 *
 * AbortError interface for cancelled requests
 */

/**
 * Create AbortError instance
 *
 * @param   String      message      Error message for human
 * @return  AbortError
 */
function AbortError(message) {
  Error.call(this, message);

  this.type = 'aborted';
  this.message = message;

  // hide custom error implementation details from end-users
  Error.captureStackTrace(this, this.constructor);
}

AbortError.prototype = Object.create(Error.prototype);
AbortError.prototype.constructor = AbortError;
AbortError.prototype.name = 'AbortError';

// fix an issue where "PassThrough", "resolve" aren't a named export for node <10
const PassThrough$1 = Stream.PassThrough;
const resolve_url = Url.resolve;

/**
 * Fetch function
 *
 * @param   Mixed    url   Absolute url or Request instance
 * @param   Object   opts  Fetch options
 * @return  Promise
 */
function fetch(url, opts) {

	// allow custom promise
	if (!fetch.Promise) {
		throw new Error('native promise missing, set fetch.Promise to your favorite alternative');
	}

	Body.Promise = fetch.Promise;

	// wrap http.request into fetch
	return new fetch.Promise(function (resolve, reject) {
		// build request object
		const request = new Request(url, opts);
		const options = getNodeRequestOptions(request);

		const send = (options.protocol === 'https:' ? https : http).request;
		const signal = request.signal;

		let response = null;

		const abort = function abort() {
			let error = new AbortError('The user aborted a request.');
			reject(error);
			if (request.body && request.body instanceof Stream.Readable) {
				request.body.destroy(error);
			}
			if (!response || !response.body) return;
			response.body.emit('error', error);
		};

		if (signal && signal.aborted) {
			abort();
			return;
		}

		const abortAndFinalize = function abortAndFinalize() {
			abort();
			finalize();
		};

		// send request
		const req = send(options);
		let reqTimeout;

		if (signal) {
			signal.addEventListener('abort', abortAndFinalize);
		}

		function finalize() {
			req.abort();
			if (signal) signal.removeEventListener('abort', abortAndFinalize);
			clearTimeout(reqTimeout);
		}

		if (request.timeout) {
			req.once('socket', function (socket) {
				reqTimeout = setTimeout(function () {
					reject(new FetchError(`network timeout at: ${request.url}`, 'request-timeout'));
					finalize();
				}, request.timeout);
			});
		}

		req.on('error', function (err) {
			reject(new FetchError(`request to ${request.url} failed, reason: ${err.message}`, 'system', err));
			finalize();
		});

		req.on('response', function (res) {
			clearTimeout(reqTimeout);

			const headers = createHeadersLenient(res.headers);

			// HTTP fetch step 5
			if (fetch.isRedirect(res.statusCode)) {
				// HTTP fetch step 5.2
				const location = headers.get('Location');

				// HTTP fetch step 5.3
				const locationURL = location === null ? null : resolve_url(request.url, location);

				// HTTP fetch step 5.5
				switch (request.redirect) {
					case 'error':
						reject(new FetchError(`redirect mode is set to error: ${request.url}`, 'no-redirect'));
						finalize();
						return;
					case 'manual':
						// node-fetch-specific step: make manual redirect a bit easier to use by setting the Location header value to the resolved URL.
						if (locationURL !== null) {
							// handle corrupted header
							try {
								headers.set('Location', locationURL);
							} catch (err) {
								// istanbul ignore next: nodejs server prevent invalid response headers, we can't test this through normal request
								reject(err);
							}
						}
						break;
					case 'follow':
						// HTTP-redirect fetch step 2
						if (locationURL === null) {
							break;
						}

						// HTTP-redirect fetch step 5
						if (request.counter >= request.follow) {
							reject(new FetchError(`maximum redirect reached at: ${request.url}`, 'max-redirect'));
							finalize();
							return;
						}

						// HTTP-redirect fetch step 6 (counter increment)
						// Create a new Request object.
						const requestOpts = {
							headers: new Headers(request.headers),
							follow: request.follow,
							counter: request.counter + 1,
							agent: request.agent,
							compress: request.compress,
							method: request.method,
							body: request.body,
							signal: request.signal,
							timeout: request.timeout
						};

						// HTTP-redirect fetch step 9
						if (res.statusCode !== 303 && request.body && getTotalBytes(request) === null) {
							reject(new FetchError('Cannot follow redirect with body being a readable stream', 'unsupported-redirect'));
							finalize();
							return;
						}

						// HTTP-redirect fetch step 11
						if (res.statusCode === 303 || (res.statusCode === 301 || res.statusCode === 302) && request.method === 'POST') {
							requestOpts.method = 'GET';
							requestOpts.body = undefined;
							requestOpts.headers.delete('content-length');
						}

						// HTTP-redirect fetch step 15
						resolve(fetch(new Request(locationURL, requestOpts)));
						finalize();
						return;
				}
			}

			// prepare response
			res.once('end', function () {
				if (signal) signal.removeEventListener('abort', abortAndFinalize);
			});
			let body = res.pipe(new PassThrough$1());

			const response_options = {
				url: request.url,
				status: res.statusCode,
				statusText: res.statusMessage,
				headers: headers,
				size: request.size,
				timeout: request.timeout,
				counter: request.counter
			};

			// HTTP-network fetch step 12.1.1.3
			const codings = headers.get('Content-Encoding');

			// HTTP-network fetch step 12.1.1.4: handle content codings

			// in following scenarios we ignore compression support
			// 1. compression support is disabled
			// 2. HEAD request
			// 3. no Content-Encoding header
			// 4. no content response (204)
			// 5. content not modified response (304)
			if (!request.compress || request.method === 'HEAD' || codings === null || res.statusCode === 204 || res.statusCode === 304) {
				response = new Response(body, response_options);
				resolve(response);
				return;
			}

			// For Node v6+
			// Be less strict when decoding compressed responses, since sometimes
			// servers send slightly invalid responses that are still accepted
			// by common browsers.
			// Always using Z_SYNC_FLUSH is what cURL does.
			const zlibOptions = {
				flush: zlib.Z_SYNC_FLUSH,
				finishFlush: zlib.Z_SYNC_FLUSH
			};

			// for gzip
			if (codings == 'gzip' || codings == 'x-gzip') {
				body = body.pipe(zlib.createGunzip(zlibOptions));
				response = new Response(body, response_options);
				resolve(response);
				return;
			}

			// for deflate
			if (codings == 'deflate' || codings == 'x-deflate') {
				// handle the infamous raw deflate response from old servers
				// a hack for old IIS and Apache servers
				const raw = res.pipe(new PassThrough$1());
				raw.once('data', function (chunk) {
					// see http://stackoverflow.com/questions/37519828
					if ((chunk[0] & 0x0F) === 0x08) {
						body = body.pipe(zlib.createInflate());
					} else {
						body = body.pipe(zlib.createInflateRaw());
					}
					response = new Response(body, response_options);
					resolve(response);
				});
				return;
			}

			// for br
			if (codings == 'br' && typeof zlib.createBrotliDecompress === 'function') {
				body = body.pipe(zlib.createBrotliDecompress());
				response = new Response(body, response_options);
				resolve(response);
				return;
			}

			// otherwise, use response as-is
			response = new Response(body, response_options);
			resolve(response);
		});

		writeToStream(req, request);
	});
}
/**
 * Redirect code matching
 *
 * @param   Number   code  Status code
 * @return  Boolean
 */
fetch.isRedirect = function (code) {
	return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
};

// expose Promise
fetch.Promise = global.Promise;

function get_page_handler(
	manifest,
	session_getter
) {
	const get_build_info =  (assets => () => assets)(JSON.parse(fs.readFileSync(path.join(build_dir, 'build.json'), 'utf-8')));

	const template =  (str => () => str)(read_template(build_dir));

	const has_service_worker = fs.existsSync(path.join(build_dir, 'service-worker.js'));

	const { server_routes, pages } = manifest;
	const error_route = manifest.error;

	function bail(req, res, err) {
		console.error(err);

		const message =  'Internal server error';

		res.statusCode = 500;
		res.end(`<pre>${message}</pre>`);
	}

	function handle_error(req, res, statusCode, error) {
		handle_page({
			pattern: null,
			parts: [
				{ name: null, component: error_route }
			]
		}, req, res, statusCode, error || new Error('Unknown error in preload function'));
	}

	async function handle_page(page, req, res, status = 200, error = null) {
		const is_service_worker_index = req.path === '/service-worker-index.html';
		const build_info




 = get_build_info();

		res.setHeader('Content-Type', 'text/html');
		res.setHeader('Cache-Control',  'max-age=600');

		// preload main.js and current route
		// TODO detect other stuff we can preload? images, CSS, fonts?
		let preloaded_chunks = Array.isArray(build_info.assets.main) ? build_info.assets.main : [build_info.assets.main];
		if (!error && !is_service_worker_index) {
			page.parts.forEach(part => {
				if (!part) return;

				// using concat because it could be a string or an array. thanks webpack!
				preloaded_chunks = preloaded_chunks.concat(build_info.assets[part.name]);
			});
		}

		if (build_info.bundler === 'rollup') {
			// TODO add dependencies and CSS
			const link = preloaded_chunks
				.filter(file => file && !file.match(/\.map$/))
				.map(file => `<${req.baseUrl}/client/${file}>;rel="modulepreload"`)
				.join(', ');

			res.setHeader('Link', link);
		} else {
			const link = preloaded_chunks
				.filter(file => file && !file.match(/\.map$/))
				.map((file) => {
					const as = /\.css$/.test(file) ? 'style' : 'script';
					return `<${req.baseUrl}/client/${file}>;rel="preload";as="${as}"`;
				})
				.join(', ');

			res.setHeader('Link', link);
		}

		let session;
		try {
			session = await session_getter(req, res);
		} catch (err) {
			return bail(req, res, err);
		}

		let redirect;
		let preload_error;

		const preload_context = {
			redirect: (statusCode, location) => {
				if (redirect && (redirect.statusCode !== statusCode || redirect.location !== location)) {
					throw new Error(`Conflicting redirects`);
				}
				location = location.replace(/^\//g, ''); // leading slash (only)
				redirect = { statusCode, location };
			},
			error: (statusCode, message) => {
				preload_error = { statusCode, message };
			},
			fetch: (url, opts) => {
				const parsed = new Url.URL(url, `http://127.0.0.1:${process.env.PORT}${req.baseUrl ? req.baseUrl + '/' :''}`);

				opts = Object.assign({}, opts);

				const include_credentials = (
					opts.credentials === 'include' ||
					opts.credentials !== 'omit' && parsed.origin === `http://127.0.0.1:${process.env.PORT}`
				);

				if (include_credentials) {
					opts.headers = Object.assign({}, opts.headers);

					const cookies = Object.assign(
						{},
						cookie.parse(req.headers.cookie || ''),
						cookie.parse(opts.headers.cookie || '')
					);

					const set_cookie = res.getHeader('Set-Cookie');
					(Array.isArray(set_cookie) ? set_cookie : [set_cookie]).forEach(str => {
						const match = /([^=]+)=([^;]+)/.exec(str);
						if (match) cookies[match[1]] = match[2];
					});

					const str = Object.keys(cookies)
						.map(key => `${key}=${cookies[key]}`)
						.join('; ');

					opts.headers.cookie = str;

					if (!opts.headers.authorization && req.headers.authorization) {
						opts.headers.authorization = req.headers.authorization;
					}
				}

				return fetch(parsed.href, opts);
			}
		};

		let preloaded;
		let match;
		let params;

		try {
			const root_preloaded = manifest.root_preload
				? manifest.root_preload.call(preload_context, {
					host: req.headers.host,
					path: req.path,
					query: req.query,
					params: {}
				}, session)
				: {};

			match = error ? null : page.pattern.exec(req.path);


			let toPreload = [root_preloaded];
			if (!is_service_worker_index) {
				toPreload = toPreload.concat(page.parts.map(part => {
					if (!part) return null;

					// the deepest level is used below, to initialise the store
					params = part.params ? part.params(match) : {};

					return part.preload
						? part.preload.call(preload_context, {
							host: req.headers.host,
							path: req.path,
							query: req.query,
							params
						}, session)
						: {};
				}));
			}

			preloaded = await Promise.all(toPreload);
		} catch (err) {
			if (error) {
				return bail(req, res, err)
			}

			preload_error = { statusCode: 500, message: err };
			preloaded = []; // appease TypeScript
		}

		try {
			if (redirect) {
				const location = Url.resolve((req.baseUrl || '') + '/', redirect.location);

				res.statusCode = redirect.statusCode;
				res.setHeader('Location', location);
				res.end();

				return;
			}

			if (preload_error) {
				handle_error(req, res, preload_error.statusCode, preload_error.message);
				return;
			}

			const segments = req.path.split('/').filter(Boolean);

			// TODO make this less confusing
			const layout_segments = [segments[0]];
			let l = 1;

			page.parts.forEach((part, i) => {
				layout_segments[l] = segments[i + 1];
				if (!part) return null;
				l++;
			});

			const props = {
				stores: {
					page: {
						subscribe: writable({
							host: req.headers.host,
							path: req.path,
							query: req.query,
							params
						}).subscribe
					},
					preloading: {
						subscribe: writable(null).subscribe
					},
					session: writable(session)
				},
				segments: layout_segments,
				status: error ? status : 200,
				error: error ? error instanceof Error ? error : { message: error } : null,
				level0: {
					props: preloaded[0]
				},
				level1: {
					segment: segments[0],
					props: {}
				}
			};

			if (!is_service_worker_index) {
				let l = 1;
				for (let i = 0; i < page.parts.length; i += 1) {
					const part = page.parts[i];
					if (!part) continue;

					props[`level${l++}`] = {
						component: part.component,
						props: preloaded[i + 1] || {},
						segment: segments[i]
					};
				}
			}

			const { html, head, css } = App.render(props);

			const serialized = {
				preloaded: `[${preloaded.map(data => try_serialize(data)).join(',')}]`,
				session: session && try_serialize(session, err => {
					throw new Error(`Failed to serialize session data: ${err.message}`);
				}),
				error: error && serialize_error(props.error)
			};

			let script = `__SAPPER__={${[
				error && `error:${serialized.error},status:${status}`,
				`baseUrl:"${req.baseUrl}"`,
				serialized.preloaded && `preloaded:${serialized.preloaded}`,
				serialized.session && `session:${serialized.session}`
			].filter(Boolean).join(',')}};`;

			if (has_service_worker) {
				script += `if('serviceWorker' in navigator)navigator.serviceWorker.register('${req.baseUrl}/service-worker.js');`;
			}

			const file = [].concat(build_info.assets.main).filter(file => file && /\.js$/.test(file))[0];
			const main = `${req.baseUrl}/client/${file}`;

			if (build_info.bundler === 'rollup') {
				if (build_info.legacy_assets) {
					const legacy_main = `${req.baseUrl}/client/legacy/${build_info.legacy_assets.main}`;
					script += `(function(){try{eval("async function x(){}");var main="${main}"}catch(e){main="${legacy_main}"};var s=document.createElement("script");try{new Function("if(0)import('')")();s.src=main;s.type="module";s.crossOrigin="use-credentials";}catch(e){s.src="${req.baseUrl}/client/shimport@${build_info.shimport}.js";s.setAttribute("data-main",main);}document.head.appendChild(s);}());`;
				} else {
					script += `var s=document.createElement("script");try{new Function("if(0)import('')")();s.src="${main}";s.type="module";s.crossOrigin="use-credentials";}catch(e){s.src="${req.baseUrl}/client/shimport@${build_info.shimport}.js";s.setAttribute("data-main","${main}")}document.head.appendChild(s)`;
				}
			} else {
				script += `</script><script src="${main}">`;
			}

			let styles;

			// TODO make this consistent across apps
			// TODO embed build_info in placeholder.ts
			if (build_info.css && build_info.css.main) {
				const css_chunks = new Set();
				if (build_info.css.main) css_chunks.add(build_info.css.main);
				page.parts.forEach(part => {
					if (!part) return;
					const css_chunks_for_part = build_info.css.chunks[part.file];

					if (css_chunks_for_part) {
						css_chunks_for_part.forEach(file => {
							css_chunks.add(file);
						});
					}
				});

				styles = Array.from(css_chunks)
					.map(href => `<link rel="stylesheet" href="client/${href}">`)
					.join('');
			} else {
				styles = (css && css.code ? `<style>${css.code}</style>` : '');
			}

			// users can set a CSP nonce using res.locals.nonce
			const nonce_attr = (res.locals && res.locals.nonce) ? ` nonce="${res.locals.nonce}"` : '';

			const body = template()
				.replace('%sapper.base%', () => `<base href="${req.baseUrl}/">`)
				.replace('%sapper.scripts%', () => `<script${nonce_attr}>${script}</script>`)
				.replace('%sapper.html%', () => html)
				.replace('%sapper.head%', () => `<noscript id='sapper-head-start'></noscript>${head}<noscript id='sapper-head-end'></noscript>`)
				.replace('%sapper.styles%', () => styles);

			res.statusCode = status;
			res.end(body);
		} catch(err) {
			if (error) {
				bail(req, res, err);
			} else {
				handle_error(req, res, 500, err);
			}
		}
	}

	return function find_route(req, res, next) {
		if (req.path === '/service-worker-index.html') {
			const homePage = pages.find(page => page.pattern.test('/'));
			handle_page(homePage, req, res);
			return;
		}

		for (const page of pages) {
			if (page.pattern.test(req.path)) {
				handle_page(page, req, res);
				return;
			}
		}

		handle_error(req, res, 404, 'Not found');
	};
}

function read_template(dir = build_dir) {
	return fs.readFileSync(`${dir}/template.html`, 'utf-8');
}

function try_serialize(data, fail) {
	try {
		return devalue(data);
	} catch (err) {
		if (fail) fail(err);
		return null;
	}
}

// Ensure we return something truthy so the client will not re-render the page over the error
function serialize_error(error) {
	if (!error) return null;
	let serialized = try_serialize(error);
	if (!serialized) {
		const { name, message, stack } = error ;
		serialized = try_serialize({ name, message, stack });
	}
	if (!serialized) {
		serialized = '{}';
	}
	return serialized;
}

function middleware(opts


 = {}) {
	const { session, ignore } = opts;

	let emitted_basepath = false;

	return compose_handlers(ignore, [
		(req, res, next) => {
			if (req.baseUrl === undefined) {
				let { originalUrl } = req;
				if (req.url === '/' && originalUrl[originalUrl.length - 1] !== '/') {
					originalUrl += '/';
				}

				req.baseUrl = originalUrl
					? originalUrl.slice(0, -req.url.length)
					: '';
			}

			if (!emitted_basepath && process.send) {
				process.send({
					__sapper__: true,
					event: 'basepath',
					basepath: req.baseUrl
				});

				emitted_basepath = true;
			}

			if (req.path === undefined) {
				req.path = req.url.replace(/\?.*/, '');
			}

			next();
		},

		fs.existsSync(path.join(build_dir, 'service-worker.js')) && serve({
			pathname: '/service-worker.js',
			cache_control: 'no-cache, no-store, must-revalidate'
		}),

		fs.existsSync(path.join(build_dir, 'service-worker.js.map')) && serve({
			pathname: '/service-worker.js.map',
			cache_control: 'no-cache, no-store, must-revalidate'
		}),

		serve({
			prefix: '/client/',
			cache_control:  'max-age=31536000, immutable'
		}),

		get_server_route_handler(manifest.server_routes),

		get_page_handler(manifest, session || noop$1)
	].filter(Boolean));
}

function compose_handlers(ignore, handlers) {
	const total = handlers.length;

	function nth_handler(n, req, res, next) {
		if (n >= total) {
			return next();
		}

		handlers[n](req, res, () => nth_handler(n+1, req, res, next));
	}

	return !ignore
		? (req, res, next) => nth_handler(0, req, res, next)
		: (req, res, next) => {
			if (should_ignore(req.path, ignore)) {
				next();
			} else {
				nth_handler(0, req, res, next);
			}
		};
}

function should_ignore(uri, val) {
	if (Array.isArray(val)) return val.some(x => should_ignore(uri, x));
	if (val instanceof RegExp) return val.test(uri);
	if (typeof val === 'function') return val(uri);
	return uri.startsWith(val.charCodeAt(0) === 47 ? val : `/${val}`);
}

function serve({ prefix, pathname, cache_control }



) {
	const filter = pathname
		? (req) => req.path === pathname
		: (req) => req.path.startsWith(prefix);

	const cache = new Map();

	const read =  (file) => (cache.has(file) ? cache : cache.set(file, fs.readFileSync(path.join(build_dir, file)))).get(file);

	return (req, res, next) => {
		if (filter(req)) {
			const type = lite.getType(req.path);

			try {
				const file = path.posix.normalize(decodeURIComponent(req.path));
				const data = read(file);

				res.setHeader('Content-Type', type);
				res.setHeader('Cache-Control', cache_control);
				res.end(data);
			} catch (err) {
				res.statusCode = 404;
				res.end('not found');
			}
		} else {
			next();
		}
	};
}

function noop$1(){}

const { PORT, NODE_ENV } = process.env;
const dev = NODE_ENV === 'development';

// const url = dev ? '/' : 'first-sapper'; // <<-

polka() // You can also use Express
	.use(
    // url, // <<-
		compression({ threshold: 0 }),
		sirv('static', { dev }),
		middleware()
	)
	.listen(PORT, err => {
		if (err) console.log('error', err);
	});
