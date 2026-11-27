import { montar } from "./fixture";

export default async function globalSetup() {
  const datos = await montar();
  // No se imprime ni el correo ni la contraseña: basta saber que está en pie.
  console.log(`Montaje listo sobre ${datos.apiUrl} · institución ficticia creada`);
}
