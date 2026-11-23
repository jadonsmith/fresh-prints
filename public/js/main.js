// Entry point: ?tv is the big screen, anything else is a phone.
const params = new URLSearchParams(location.search);
if (params.has("tv")) import("./tv.js?v=1").then((m) => m.startTv());
else import("./phone.js?v=1").then((m) => m.startPhone());
