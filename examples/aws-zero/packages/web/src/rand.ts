export const randBetween = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min) + min);
export const randInt = (max: number) => randBetween(0, max);
export const randID = () => Math.random().toString(36).slice(2);
