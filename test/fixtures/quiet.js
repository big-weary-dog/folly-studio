// A logger that says nothing, for the server, the render box and the stores under test.
export const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
