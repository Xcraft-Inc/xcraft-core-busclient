'use strict';

var moduleName = 'busclient/command';

var xLog = require ('xcraft-core-log') (moduleName, null);


function Command (busClient, pushSocket) {
  this._busClient = busClient;
  this._push      = pushSocket;
}

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
    which = this._busClient.getOrcName ();
  }

  if (finishHandler) {
    /* Subscribe to end command notification. */
    const finishTopic = `${which}::${cmd}.finished`;
    self._busClient.events.subscribe (finishTopic);

    self._busClient.getEventsRegistry ()[finishTopic] = function (msg) {
      self._busClient.events.unsubscribe (finishTopic);
      finishHandler (null, msg);
    };

    xLog.verb ('finish handler registered for cmd: ' + cmd);
  }

  var busMessage = self._busClient.newMessage (which);

  busMessage.data = data;

  xLog.verb ('client send \'%s\' command', cmd);
  self._push.send (cmd, busMessage);
};

module.exports = Command;
