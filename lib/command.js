'use strict';

var moduleName = 'bus-command';

var xLog = require ('xcraft-core-log') (moduleName);
var xBus = require ('xcraft-core-bus');


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
 * @param {Object} [data] - Map of arguments passed to the command.
 * @param {Function(err, results)} [finishHandler] - Callback.
 */
Command.prototype.send = function (cmd, data, finishHandler) {
  if (finishHandler) {
    /* Subscribe to end command notification. */
    var finishTopic = this._busClient.topicModifier (cmd + '.finished');
    this._busClient.events.subscribe (finishTopic);

    this._busClient.getEventsRegistry ()[finishTopic] = function (msg) {
      this._busClient.events.unsubscribe (finishTopic);
      finishHandler (null, msg);
    };

    xLog.verb ('finish handler registered for cmd: ' + cmd);
  }

  var busMessage = xBus.newMessage ();

  busMessage.data = data;

  xLog.verb ('client send \'%s\' command', cmd);
  this._push.send (cmd, busMessage);
};

module.exports = Command;
