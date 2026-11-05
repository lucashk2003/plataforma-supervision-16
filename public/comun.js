/*
 * comun.js — Funciones compartidas del frontend
 *  - Interpreta fechas, emisor y metadatos de cada archivo
 *  - Se puede probar en Node: node -e "console.log(require('./comun.js'))"
 */
(function (root) {
  const MESES = { ENE: '01', FEB: '02', MAR: '03', ABR: '04', MAY: '05', JUN: '06',
                  JUL: '07', AGO: '08', SET: '09', SEP: '09', OCT: '10', NOV: '11', DIC: '12' };

  // Devuelve { texto, orden } o null. Acepta "26-JUL-2019", "01-MAR_2021", "2019-07-26", "26/07/2019" o "2018".
  function parseFecha(valor) {
    if (!valor) return null;
    const v = String(valor).trim();
    let m;
    if ((m = v.match(/(\d{2})[-_/]([A-Za-z]{3})[-_/](\d{4})/)) && MESES[m[2].toUpperCase()]) {
      return armar(m[3], MESES[m[2].toUpperCase()], m[1]);
    }
    if ((m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return armar(m[1], m[2], m[3]);
    if ((m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) return armar(m[3], m[2], m[1]);
    if ((m = v.match(/^(\d{4})$/))) return { texto: m[1], orden: Number(m[1]) * 10000 };
    return null;
  }
  function armar(a, mes, d) {
    return { texto: `${d}/${mes}/${a}`, orden: Number(a) * 10000 + Number(mes) * 100 + Number(d) };
  }

  // Fecha desde el nombre del archivo; si no hay fecha completa, usa el año final (…_2018.pdf)
  function fechaDeNombre(nombre) {
    const completa = parseFecha(nombre);
    if (completa) return completa;
    const anio = nombre.match(/((?:19|20)\d{2})(?=\.[A-Za-z]+$)/);
    return anio ? parseFecha(anio[1]) : null;
  }

  function emiteDeNombre(nombre) {
    if (/^NOTA_SUP_/.test(nombre)) return 'SUP 16';
    if (/(?:^|[_-])DGE(?=[_.-])/.test(nombre)) return 'DGE';
    return null;
  }

  // Un metadato puede ser un texto (descripción) o un objeto { descripcion, fecha, numero, emite }
  function armarFila(archivo, metadato, emiteDefault) {
    const meta = typeof metadato === 'string' ? { descripcion: metadato } : (metadato || {});
    const fecha = parseFecha(meta.fecha) || fechaDeNombre(archivo);
    return {
      archivo,
      descripcion: meta.descripcion || archivo.replace(/_/g, ' ').replace(/\.pdf$/i, ''),
      fecha,
      emite: meta.emite || emiteDeNombre(archivo) || emiteDefault || null,
    };
  }

  // Fecha ascendente; los que no tienen fecha van al final, ordenados por nombre
  function ordenar(filas) {
    return filas.sort((a, b) => {
      const oa = a.fecha ? a.fecha.orden : Infinity;
      const ob = b.fecha ? b.fecha.orden : Infinity;
      if (oa !== ob) return oa < ob ? -1 : 1;
      return a.archivo.localeCompare(b.archivo, 'es', { numeric: true });
    });
  }

  function esc(texto) {
    return String(texto).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const api = { parseFecha, fechaDeNombre, emiteDeNombre, armarFila, ordenar, esc };
  if (typeof module !== 'undefined') module.exports = api; else root.Comun = api;
})(this);
