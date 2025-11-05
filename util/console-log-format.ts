function overrideConsoleLogFunctions() {
    const originalLog = console.log;
    console.log = (...args) => {
        // TODO: check if `args[0]` is actually a string.
        originalLog(`${new Date().toISOString()} ${args[0]}`, ...args.slice(1));
    };

    const originalInfo = console.info;
    console.info = (...args) => {
        // TODO: check if `args[0]` is actually a string.
        originalInfo(`${new Date().toISOString()} INFO ${args[0]}`, ...args.slice(1));
    };
}

export default overrideConsoleLogFunctions;
