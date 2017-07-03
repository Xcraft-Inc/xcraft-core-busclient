'use strict';

var moduleName = 'busclient/command';

var xLog = require ('xcraft-core-log') (moduleName, null);

function Message (busClient, cmd, which) {
  if (!which) {
    which = busClient.getOrcName () || 'greathall';
  }

  return busClient.newMessage (cmd, which);
}

function Command (busClient, pushSocket) {
  this._busClient = busClient;
  this._push = pushSocket;
}

Command.prototype.newMessage = function (...args) {
  return new Message (this._busClient, ...args);
};

/**
 * Send a command on the bus.
 *
 * If a callback is specified, the finished topic is automatically
 * subscribed to the events bus. Then when the callback is called, the
 * topic is unsubscribed.
 *
 * @param {string} cmd - Command's name.
 * @param {Object} data - Map of arguments passed to the command.
 * @param {string} which - Orc name or greathall.
 * @param {function(err, results)} [finishHandler] - Callback.
 */
Command.prototype.send = function (cmd, data, which, finishHandler) {
  var self = this;

  if (!which) {
    which = this._busClient.getOrcName () || 'greathall';
  }

  let busMessage = data;
  if (!(data instanceof Message)) {
    busMessage = self.newMessage (cmd, which);
  }

  if (finishHandler) {
    let finishUnsubscribe = null;
    /* Subscribe to error in command notification. */
    const errorTopic = `${which}::${cmd}.${busMessage.id}.error`;
    const errUnsubscribe = self._busClient.events.subscribe (
      errorTopic,
      function (msg) {
        errUnsubscribe ();
        finishUnsubscribe ();
        finishHandler (msg.data);
      }
    );

    /* Subscribe to end command notification. */
    const finishTopic = `${which}::${cmd}.${busMessage.id}.finished`;
    finishUnsubscribe = self._busClient.events.subscribe (
      finishTopic,
      function (msg) {
        errUnsubscribe ();
        finishUnsubscribe ();
        finishHandler (null, msg);
      }
    );

    xLog.verb ('finish handler registered for cmd: ' + cmd);
  }

  busMessage.data = data;

  xLog.verb ("client send '%s' command", cmd);
  self._push.send (cmd, busMessage);
};

module.exports = Command;
