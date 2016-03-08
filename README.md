# ttb-node-serialport

This node is a fork of the Node-RED serial port.

It is part of the Thingbox ([http://thethingbox.io](http://thethingbox.io)) but it can be used in any Node-RED installation.

This serial port node is dedicated to USB Key that may not be plugged. In that cas, we don't want an error to be thrown.
See
[lot of errors from Serial port Node when the USB key is missing.](https://groups.google.com/forum/#!searchin/node-red/serial/node-red/VHAC0Foc_80/tC-n34RiDwAJ)

With this node, you can desactivate the error by asking to never check, or by setting the check delay.

You can also silently handle the error on the second output.

## Content

 - Edit box: nb of seconds to check if the key is present (0: only one test at boot)

- dedicated output for errors. The error message is in msg.payload and msg.message

## Installation

- copy and past the content of ```release/``` into the Node-RED nodes directory
- Do a ```npm install``` into the node directory

## Support

thethingbox@gmail.com

