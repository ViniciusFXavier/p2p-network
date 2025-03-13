export class EventEmitter {
  constructor() {
    this.events = {};
  }

  emit(eventName, value) {
    const listeners = this.events[eventName];
    if (listeners) {
      listeners.forEach((event) => {
        event.callback(value);
      });
    }
    return this;
  }

  on(eventName, callback, caller) {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }

    this.events[eventName].push({ callback, caller });
    return this;
  }

  off(eventName, callback) {
    if (this.events[eventName]) {
      this.events[eventName] = [...this.events[eventName]].filter(
        (event) => event.callback !== callback
      );
    }
    return this;
  }
}
