# Tianchuang Cloud LocalSend sidecar

This process connects the Electron main process to the LocalSend protocol using newline-delimited JSON on stdin/stdout.

Parts of the device identity, discovery, send and receive flow are adapted from the LocalSend CLI, licensed under Apache License 2.0. The upstream project is <https://github.com/localsend/localsend>. Tianchuang Cloud is not an official LocalSend distribution.

The sidecar intentionally owns no UI and never changes firewall rules. Incoming files are written to temporary `.part` files and renamed only after the LocalSend core reports a successful, checksum-verified transfer.

The build uses the minimal Rust core snapshot in `native/vendor/localsend-core`,
copied from the LocalSend source supplied with this project. Vendoring only the
protocol core keeps builds reproducible without treating the full Flutter source
tree and its build products as Tianchuang Cloud application source.

