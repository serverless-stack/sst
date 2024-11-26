class ErrArrayEmpty extends Error {}

ErrArrayEmpty.prototype.name = "ErrArrayEmpty";

export function mustTakeFirst<A>(array: Array<A>): A {
  if (array.length < 1) {
    throw new ErrArrayEmpty("Array is empty");
  }

  const item = array[0]!;
  return item;
}
