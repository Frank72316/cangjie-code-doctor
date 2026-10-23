// Explicit test double: this does not test or claim OS locking/Docker recovery.
export async function fakeLifecycleFactory() {
  return {lease:{signal:new AbortController().signal}, recovered:[],
    async container(options, factory) { return factory(options); }, async release() {}};
}
