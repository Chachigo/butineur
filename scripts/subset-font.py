#!/usr/bin/env python3
"""
Réduit la police Phosphor aux seules icônes embarquées.

La police complète pèse 1510 icônes pour la petite centaine qu'on utilise —
c'est le plus gros poids mort de l'appli, chargé au premier écran côté web et
empaqueté dans l'APK côté Android.

À lancer après `scripts/build-icons.mjs`, dont on lit la sortie : les
caractères réellement retenus y sont déjà, inutile de redire la liste ici.

    pip install fonttools brotli
    python3 scripts/subset-font.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SRC = RACINE / 'node_modules/@phosphor-icons/web/src/duotone'
GENERE = RACINE / 'src/ui/icons.generated.ts'
CIBLES = [
    (SRC / 'Phosphor-Duotone.woff2', RACINE / 'public/fonts/phosphor.woff2', 'woff2'),
    (SRC / 'Phosphor-Duotone.ttf', RACINE / 'android/app/src/main/res/font/phosphor.ttf', 'ttf'),
]


def caracteres_retenus() -> set[str]:
    texte = GENERE.read_text(encoding='utf-8')
    m = re.search(r'PHOSPHOR_GROUPS: \[string, \[string, string\]\[\]\]\[\] = (\[.*?\])\n', texte, re.S)
    if not m:
        sys.exit('icons.generated.ts illisible — lancer scripts/build-icons.mjs d’abord')
    groupes = json.loads(m.group(1))
    # Every duotone icon is worth two characters: the background and the detail.
    return {c for _, icones in groupes for _, chars in icones for c in chars}


def main() -> None:
    chars = caracteres_retenus()
    unicodes = ','.join(f'U+{ord(c):04X}' for c in sorted(chars))

    for source, sortie, flavor in CIBLES:
        avant = source.stat().st_size
        cmd = [
            sys.executable, '-m', 'fontTools.subset', str(source),
            f'--unicodes={unicodes}',
            f'--output-file={sortie}',
            '--no-layout-closure',
        ]
        if flavor == 'woff2':
            cmd.append('--flavor=woff2')
        subprocess.run(cmd, check=True)
        apres = sortie.stat().st_size
        print(f'{sortie.name} : {avant // 1024} ko → {apres // 1024} ko '
              f'(-{100 - apres * 100 // avant} %)')

    print(f'{len(chars)} glyphes gardés, pour {len(chars) // 2} icônes.')


if __name__ == '__main__':
    main()
