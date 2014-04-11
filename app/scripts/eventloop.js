// basic event loop that's based on requestAnimationFrame

// Usage:
// loop = new EventLoop();
// loop.do(callback);
// loop.do(callback2);
// .. return here
// loop will run...


function EventLoop() {
    this._dirty = false;
    this._callbacks = [];
}

EventLoop.prototype.run = function() {

};

Object.defineProperty(EventLoop.prototype,
                      'dirty', {
                          get: function() { return this._dirty; },
                          set: function(d) { this._dirty = d;
                                             this.schedule(); }
                      });

EventLoop.prototype.tick() = function() {
    var callbacks = this._callbacks.splice(0, this._callbacks.length);
    for (var i = 0; i < callbacks.length; ++i) {
        var f = callbacks[i];
        f();
    }
    this.schedule();
};

EventLoop.prototype.do = function(callback) {
    this._callbacks.push(callback);
    this.dirty = true;
};

EventLoop.prototype.schedule = function() {
    if (this.dirty) {
        this.requestAnimationFrame(this.tick.bind(this));
    }
};
