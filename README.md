# xcraft-core-busclient

Client for the Xcraft bus.

This module provides the interfaces in order to connect to a server, send
commands and send or subscribe to events.

It provides the global busClient too. This handler must be used between the
modules in order to have always the same connection everywhere. Otherwise
you can connect to several servers by instancing a new busClient for each one.
