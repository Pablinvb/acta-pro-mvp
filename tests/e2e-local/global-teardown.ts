import { desmontar } from "./fixture";

export default async function globalTeardown() {
  await desmontar();
  console.log("Montaje retirado de la pila local.");
}
