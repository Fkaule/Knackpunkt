# Knackpunkt

FEM-Minispiel: Aus einem Bauteil Kacheln entfernen, dann rechnet eine echte FE-Rechnung (ebener Spannungszustand, im Browser), ob es hält. Allein gegen den ESO-Algorithmus oder als Wettkampf mit Raumcode und Auflösung am Beamer, blind oder mit offenen Karten. Neben drei festen Bauteilen gibt es Zufallsbauteile und einen Baukasten für eigene Bauteile.

Allein üben: https://fkaule.github.io/Knackpunkt/

## Wie gerechnet wird

Kurzfassung: lineare Elastostatik einer dünnen Stahlscheibe im ebenen Spannungszustand, gelöst mit der Finite-Elemente-Methode. Der Nachweis vergleicht die über jede Kachel gemittelte Vergleichsspannung nach von Mises mit der Streckgrenze. Alles steht in `src/fem.js` (ohne Bibliotheken) und wird bei jedem Aufdecken vollständig neu gerechnet.

```
Entwurf: welche Kacheln stehen noch?
    |
    v
Zusammenhang: was hängt am Lager, was trägt die Last?
    |
    v
Steifigkeitsmatrix K aus lauter gleichen Elementmatrizen
    |
    v
Lager einsetzen, K u = f lösen (Band-Cholesky)
    |
    v
Spannungen im Mittelpunkt jedes Elements
    |
    v
Vergleichsspannung, Mittelwert je Kachel, geteilt durch Re
    |
    v
Alle Kacheln höchstens 100 %?
    |
    +-- ja:   hält, Punkte = entfernte Prozent
    |
    +-- nein: Bruch, 0 Punkte
```

### 1. Modell

- Das Bauteil ist eine ebene Scheibe der Dicke $`t = 10\,\mathrm{mm}`$ aus Stahl S235: $`E = 210\,000\,\mathrm{MPa}`$, $`\nu = \text{0,3}`$, $`R_e = 235\,\mathrm{MPa}`$.
- Es besteht aus Kacheln von $`10 \times 10\,\mathrm{mm}`$. Jede Kachel ist mit $`4 \times 4`$ quadratischen Elementen der Kantenlänge $`h = \text{2,5}\,\mathrm{mm}`$ vernetzt. Das Netz ist fest: Jeder Entwurf wird auf demselben Raster gerechnet.
- Eine entfernte Kachel fehlt im Modell ganz. Es gibt keine weiche Ersatzsteifigkeit wie bei der Topologieoptimierung.
- Annahmen: linear elastisch, kleine Verformungen, statisch, ebener Spannungszustand. Nicht berücksichtigt: Eigengewicht, Knicken und Beulen, Plastizität.

```
Kachel (10 mm) = 4 x 4 Elemente        ein Element (h = 2,5 mm)

+---+---+---+---+                       4 +-------+ 3
|   |   |   |   |                         |       |    Knoten gegen den Uhrzeigersinn,
+---+---+---+---+                         |   o   |    je Knoten die Verschiebungen u und v;
|   |   |   |   |                         |       |    im Mittelpunkt o werden die
+---+---+---+---+                       1 +-------+ 2  Spannungen ausgewertet
|   |   |   |   |
+---+---+---+---+
|   |   |   |   |
+---+---+---+---+
```

### 2. Werkstoffgesetz

Hooke im ebenen Spannungszustand mit $`\boldsymbol\sigma = (\sigma_x, \sigma_y, \tau_{xy})^T`$ und $`\boldsymbol\varepsilon = (\varepsilon_x, \varepsilon_y, \gamma_{xy})^T`$:

```math
\boldsymbol\sigma = \mathbf D\,\boldsymbol\varepsilon, \qquad
\mathbf D = \frac{E}{1-\nu^2}\begin{bmatrix} 1 & \nu & 0 \\ \nu & 1 & 0 \\ 0 & 0 & \frac{1-\nu}{2} \end{bmatrix}
```

### 3. Element: Viereck mit inkompatiblen Moden

Ein normales bilineares Viereckelement (Q4) ist bei Biegung viel zu steif (Schubversteifung, „shear locking“). Das wäre hier fatal, denn die Stäbe im Spiel sind oft nur eine Kachel breit, also vier Elemente dick. Deshalb bekommt jedes Element vier zusätzliche innere Verschiebungsmoden (Q6 nach Wilson, als QM6 nach Taylor), mit denen ein Rechteckelement reine Biegung exakt abbilden kann.

Verschiebungen im Element mit den natürlichen Koordinaten $`\xi, \eta \in [-1, 1]`$ und den Eckknoten $`(\xi_i, \eta_i) = (\pm 1, \pm 1)`$:

```math
u = \sum_{i=1}^{4} N_i\,u_i + (1-\xi^2)\,\alpha_1 + (1-\eta^2)\,\alpha_2, \qquad
v = \sum_{i=1}^{4} N_i\,v_i + (1-\xi^2)\,\alpha_3 + (1-\eta^2)\,\alpha_4
```

```math
N_i = \tfrac14\,(1+\xi_i\,\xi)(1+\eta_i\,\eta)
```

Damit gilt $`\boldsymbol\varepsilon = \mathbf B\,\mathbf u_e + \mathbf G\,\boldsymbol\alpha`$ mit den acht Knotenverschiebungen $`\mathbf u_e`$, der üblichen Matrix $`\mathbf B`$ des Q4-Elements und

```math
\mathbf G = \frac{2}{h}\begin{bmatrix} -2\xi & 0 & 0 & 0 \\ 0 & 0 & 0 & -2\eta \\ 0 & -2\eta & -2\xi & 0 \end{bmatrix}
```

Die Teilmatrizen werden mit $`2 \times 2`$ Gauß-Punkten integriert, mit $`\mathrm dA = \tfrac{h^2}{4}\,\mathrm d\xi\,\mathrm d\eta`$:

```math
\mathbf K_{uu} = \int \mathbf B^T \mathbf D\,\mathbf B\,t\,\mathrm dA, \qquad
\mathbf K_{u\alpha} = \int \mathbf B^T \mathbf D\,\mathbf G\,t\,\mathrm dA, \qquad
\mathbf K_{\alpha\alpha} = \int \mathbf G^T \mathbf D\,\mathbf G\,t\,\mathrm dA
```

Die inneren Moden gehören zu keinem Nachbarelement und werden statisch kondensiert:

```math
\mathbf K_e = \mathbf K_{uu} - \mathbf K_{u\alpha}\,\mathbf K_{\alpha\alpha}^{-1}\,\mathbf K_{u\alpha}^T
```

Alle Elemente sind gleich große Quadrate, deshalb wird $`\mathbf K_e`$ nur einmal berechnet. Beim Quadrat hängt $`\mathbf K_e`$ nicht von $`h`$ ab, weil $`\mathbf B \sim 1/h`$ und $`\mathrm dA \sim h^2`$. In ANSYS entspricht das Element etwa PLANE182 mit Enhanced Strain (KEYOPT(1) = 2) im ebenen Spannungszustand mit Dicke.

### 4. Gesamtsystem

**Welche Kacheln gerechnet werden.** Zuerst prüft das Spiel den Zusammenhang über gemeinsame Kanten:

- Kacheln ohne Verbindung zu einem Lager fallen ab und zählen als entfernt.
- Hat eine Lastkachel keine Verbindung mehr zu einem Lager, versagt der Entwurf sofort (Lastpfad unterbrochen).
- Gerechnet werden nur Kacheln, die mit einer Lastkachel verbunden sind. Totes Material am Lager trägt nichts.
- Berühren sich zwei Kacheln nur an einer Ecke, bekommen sie dort getrennte Knoten. Real hat dieser Kontakt keinen Querschnitt, im FE-Modell wäre er ein Gelenk, das Kraft überträgt.

**Aufbau und Randbedingungen.** $`\mathbf K = \sum_e \mathbf K_e`$ nach üblicher Assemblierung, dann $`\mathbf K\,\mathbf u = \mathbf f`$.

- Lager sperren Freiheitsgrade an allen fünf Knoten einer Kachelkante: Einspannung und Festlager $`u = v = 0`$, Loslager nur $`v = 0`$. Gesperrte Freiheitsgrade werden aus dem System gestrichen.
- Die Last $`F`$ wirkt als gleichmäßige Linienlast auf der Kante der Lastkachel, nicht als Punktlast, damit am Lastangriff keine Singularität entsteht. Bei $`n`$ belasteten Elementkanten bekommt jede Kante $`F/n`$, je zur Hälfte an ihre beiden Endknoten (konsistente Knotenkräfte für lineare Ansätze).

**Lösen.** $`\mathbf K`$ ist symmetrisch und positiv definit, solange die Lager jede Starrkörperbewegung verhindern. Die Knoten sind entlang der kurzen Bauteilseite nummeriert. Dadurch ist $`\mathbf K`$ eine Bandmatrix mit der halben Bandbreite $`b \approx 2\,(n_y + 2)`$, wobei $`n_y`$ die Zahl der Elemente über die kurze Seite ist. Gelöst wird mit Cholesky $`\mathbf K = \mathbf U^T \mathbf U`$ im Bandspeicher (Aufwand $`\sim n\,b^2`$) und Vorwärts- und Rückwärtseinsetzen. Beim vollen Kragarm sind das 2048 Elemente und 4224 Freiheitsgrade, gelöst in etwa 15 ms.

**Starrkörperbewegung.** Wird bei der Zerlegung ein Pivot kleiner als $`10^{-7}\,K_{e,11}`$, ist $`\mathbf K`$ singulär: Das Restbauteil kann sich bewegen, etwa eine Brücke, die nur noch auf dem Loslager steht. Das zählt als Versagen (Mechanismus).

### 5. Nachweis

Die Spannungen werden im Mittelpunkt jedes Elements ausgewertet. Dort verschwinden die Ableitungen der inkompatiblen Moden, $`\mathbf G(0,0) = \mathbf 0`$, also gilt

```math
\boldsymbol\sigma_e = \mathbf D\,\mathbf B(0,0)\,\mathbf u_e
```

Vergleichsspannung nach von Mises im ebenen Spannungszustand und Auslastung $`A_k`$ einer Kachel $`k`$ als Mittelwert über ihre 16 Elemente:

```math
\sigma_v = \sqrt{\sigma_x^2 - \sigma_x\,\sigma_y + \sigma_y^2 + 3\,\tau_{xy}^2}, \qquad
A_k = \frac{1}{16\,R_e}\sum_{e \in k} \sigma_{v,e}
```

Der Entwurf hält, wenn $`\max_k A_k \le 1`$ gilt, die Last einen Weg zum Lager hat und keine Starrkörperbewegung möglich ist.

**Warum gemittelt wird.** Jede entfernte Kachel erzeugt einspringende 90°-Ecken. In der linearen Elastizitätstheorie ist die Spannung dort singulär ($`\sigma \sim r^{-\text{0,46}}`$), der Spitzenwert hängt also nur vom Netz ab. Der Mittelwert über eine Kachel ist dagegen eine stabile Größe und entspricht grob einer Spannungsmittelung nach Neuber. Für duktilen Stahl ist das vertretbar: Örtliche Spitzen dürfen fließen, entscheidend ist, ob der Querschnitt trägt.

**Was das für die Prüfung heißt.** Die Kachelmittelung ist eine Spielregel, kein Normnachweis:

- Zug- und Druckstäbe werden praktisch mit ihrer Nennspannung bewertet.
- Bei reiner Biegung eines Stabs von einer oder zwei Kacheln Breite ist das Mittel über eine Kachel die halbe Randspannung. Der Stab gilt also erst bei der doppelten elastischen Randspannung als versagt. Das liegt über der plastischen Reserve eines Rechteckquerschnitts (Faktor 1,5), ist für schmale Biegestäbe also eher unsicher. Bei breiteren Stäben nähert sich das Kriterium der Randspannung.
- Knicken wird nicht gerechnet: Schlanke Druckstäbe halten im Spiel, die in echt ausknicken würden.

### 6. Wertung

```math
\text{entfernt} = 1 - \frac{\text{Kacheln mit Verbindung zu einem Lager}}{\text{Kacheln des Vollteils}}
```

Die Punkte sind die entfernten Prozent, bei Versagen 0. Masse je Kachel: $`1\,\mathrm{cm^3} \cdot \text{7,85}\,\mathrm{g/cm^3} = \text{7,85}\,\mathrm g`$.

### 7. Gegner: Evolutionäre Strukturoptimierung (ESO)

Nach Xie und Steven: Ausgehend vom Vollteil werden die Kacheln nach Auslastung sortiert. Die am geringsten ausgelastete Kachel, deren Wegnahme den Nachweis noch erfüllt, wird entfernt, danach wird neu gerechnet. Das wiederholt sich, bis keine Kachel mehr entfernt werden kann. Das Verfahren ist gierig und endet in einem lokalen Optimum, deshalb ist es schlagbar.

### 8. Bauteile und Lasten

Die Lasten sind so gewählt, dass das Vollteil zu gut 50 % ausgelastet ist:

| Bauteil | Lager | Last (Linienlast) | Auslastung Vollteil | ESO entfernt |
|---|---|---|---|---|
| Kragarm 160 × 80 mm | linke Kante eingespannt | 10 kN nach unten auf 20 mm der rechten Kante, mittig | 55,9 % | 58,6 % |
| Brücke 200 × 60 mm | Festlager links, Loslager rechts, je 10 mm | 20 kN nach unten auf 20 mm der Oberkante, mittig | 50,6 % | 60,0 % |
| L-Winkel 120 × 120 mm, Schenkel 50 mm breit | obere Kante des senkrechten Schenkels eingespannt | 6 kN nach unten auf 10 mm am Ende des waagrechten Schenkels | 57,3 % | 53,7 % |

Gesperrt und nicht entfernbar sind die Lastkacheln und die Kacheln unter Fest- und Loslager.

Zufallsbauteile und eigene Bauteile werden genauso bemessen, nur automatisch: Das Vollteil wird mit 1 kN gerechnet. Weil das Modell linear ist, wächst die Auslastung proportional zur Last. Gewählt wird aus 1; 1,2; 1,5; 2; 2,5; 3; 4; 5; 6; 8; 10; 12; 15; 20; 25; 30; 40; 50; 60; 80; 100 kN der Wert, bei dem das Vollteil am nächsten an 55 % ausgelastet ist (in `src/parts.js`, Funktion `scale`). Lastrichtungen gibt es in Schritten von 45°.

### 9. Prüfung

`npm test` rechnet einen schlanken Kragbalken (Länge 320 mm, Last 1 kN als Linienlast am freien Ende) und vergleicht die Durchbiegung mit dem Timoshenko-Balken

```math
w = \frac{F L^3}{3 E I} + \frac{F L}{\kappa\,G A}, \qquad \kappa = \tfrac56, \qquad G = \frac{E}{2\,(1+\nu)}
```

sowie die Biegespannung im Elementmittelpunkt der obersten Elementreihe nahe der Balkenmitte mit $`\sigma_x = M\,z/I`$:

| Höhe | Elemente über die Höhe | Durchbiegung FE | Theorie | Abweichung | $`\sigma_x`$ FE | Theorie | Abweichung |
|---|---|---|---|---|---|---|---|
| 10 mm | 4 | 62,412 mm | 62,463 mm | -0,08 % | 714,35 MPa | 714,38 MPa | 0,00 % |
| 20 mm | 8 | 7,815 mm | 7,826 mm | -0,13 % | 208,36 MPa | 208,36 MPa | 0,00 % |

Weitere Tests: Eine Brücke nur auf dem Loslager wird als Mechanismus erkannt, nur auf dem Festlager nicht. ESO entfernt beim Kragarm 75 von 128 Kacheln.

Noch nicht verglichen: ein Spielentwurf mit Kerben gegen ANSYS auf demselben Netz (PLANE182, Enhanced Strain, ebener Spannungszustand, Dicke 10 mm), verglichen über die Vergleichsspannung im Elementmittelpunkt.

### 10. Wo steht was in `src/fem.js`

| Schritt | Stelle |
|---|---|
| Werkstoff, Element, Kondensation, Spannungsmatrix $`\mathbf D\,\mathbf B(0,0)`$ | Block `KE, S` am Anfang |
| Lager und Lasten als Knotenwerte, gesperrte Kacheln | `level()` |
| Zusammenhang über Kanten | `connect()` |
| Eckkontakt, Nummerierung, Assemblierung, Cholesky, Spannungen, Auslastung | `analyze()` |
| Gegner | `eso()` |

### Literatur

- E. L. Wilson, R. L. Taylor, W. P. Doherty, J. Ghaboussi: Incompatible displacement models. In: Numerical and Computer Methods in Structural Mechanics, Academic Press, 1973.
- R. L. Taylor, P. J. Beresford, E. L. Wilson: A non-conforming element for stress analysis. International Journal for Numerical Methods in Engineering 10 (1976).
- Y. M. Xie, G. P. Steven: A simple evolutionary procedure for structural optimization. Computers & Structures 49 (1993).
- H. Neuber: Kerbspannungslehre. Springer, 2. Auflage 1958.

## Aufbau

- `src/fem.js`: FE-Kern (Viereckelemente mit inkompatiblen Moden, Band-Cholesky, ESO), ohne DOM
- `src/parts.js`: Zufallsbauteile aus einer Nummer, Baukasten-Prüfung, Bemessung der Last, Code für Links, ohne DOM
- `src/game.js`: Spiel, Zeichnung, Baukasten, Wettkampf (Presence über claude.ai-Raum oder eigenen Server)
- `src/shell.html`: Seite und Stil
- `game.html`: gebaute Spieldatei (Seitenfragment), läuft als claude.ai-Artifact und über `server.mjs`
- `index.html`: dieselbe Seite als vollständiges Dokument für GitHub Pages (Quelle `main`, Hauptverzeichnis, `.nojekyll`); dort gibt es nur „Allein üben“, der Wettkampf braucht den Server
- `server.mjs`: liefert das Spiel aus und verteilt den Status aller Geräte per WebSocket (`ws`), Status unter `api/status`

## Befehle

```
npm install
npm run build   # game.html und index.html aus src/ bauen
npm test        # FE-Kern gegen Balkentheorie, Mechanismus, ESO-Richtwert; Zufallsbauteile und Baukasten
npm start       # Server auf PORT (Standard 8080)
```

Der Server liest `game.html` beim Start ein: nach jedem Build neu starten.

## Bauteile

- **Fest:** Kragarm, Brücke, L-Winkel (Tabelle oben)
- **Zufall:** Jede Nummer von 1 bis 99.999 ergibt auf jedem Gerät dasselbe Bauteil. Acht Bauformen (Kragarm, Träger, Konsole, Winkel, Rahmen, Mast, Galgen, Hänger) mit zufälligen Maßen, Aussparungen, manchmal einem vorgegebenen Loch, Lastangriff und Lastrichtung. Die Nummer steht im Link (`#nr-4711`), damit man ein Bauteil wiederholen oder weitergeben kann
- **Bauen:** Im Baukasten Material aufziehen, Einspannung, Festlager, Loslager und eine Last an Außenkanten setzen; das Spiel prüft, ob das Bauteil gelagert ist, und bemisst die Last. Zum Start wird das zuletzt gezeigte Bauteil übernommen, man kann es also auch abwandeln. Beim Spielen steht das Bauteil im Link (`#bau-…`)

## Spielarten

- **Blind:** Man entfernt Material, ohne die Spannungen zu sehen. Erst beim Abgeben rechnet die FEM. Eine Probe-Rechnung zeigt zwischendurch die Spannungen des aktuellen Entwurfs, bis man weiterarbeitet (allein eine, im Wettkampf legt die Spielleitung 0 bis 5 fest). Allein gibt es zum Üben zusätzlich Live-Spannungen.
- **Offene Karten:** Nach jeder Wegnahme rechnet die FEM sofort und zeigt die Spannungen. Jede Wegnahme ist endgültig, es gibt kein Rückgängig und kein Zurückholen. Versagt das Bauteil, ist der Versuch sofort vorbei und zählt nichts. Wer aufhört, lässt den aktuellen Stand werten.

## Wettkampf

- Spielleitung: „Mehrspieler“, „Neues Spiel eröffnen“, Bauteil, Zeit und Spielart wählen, Runde starten. Als Bauteil geht auch „Zufallsbauteil“ (jede Runde ein neues, alle bekommen dasselbe) und „Eigenes Bauteil“ (das zuletzt auf diesem Gerät im Baukasten gespielte)
- Mitspielende: Link mit `#RAUMCODE` öffnen oder Code eintippen, Pseudonym eintragen
- Blind: Die Spielleitung legt je Runde fest, wie viele Probe-Rechnungen jede Person hat (0 bis 5); der Beamer zeigt die verbrauchten Proben
- Offene Karten: Der Beamer zeigt live, wie viel jede Person schon entfernt hat, grün heißt aufgehört, rot heißt Bruch. Wer bricht, ist in dieser Runde raus
- Ende der Zeit gibt automatisch ab; die FEM rechnet alle Entwürfe bei der Spielleitung, Punkte = entfernte Prozent, wenn es hält, sonst 0

## Deploy mit Docker

```
KNACKPUNKT_HOST=<ssh-name des Servers> scripts/deploy.sh
```

Baut `game.html`, kopiert die nötigen Dateien nach `~/knackpunkt` auf dem Server, baut dort das Image und startet den Container `knackpunkt` neu (`--restart unless-stopped`, nur lokal auf `127.0.0.1:8907`). Bricht ab, wenn gerade eine Runde läuft (`--force` erzwingt den Neustart).

Nach außen geht es über nginx: `deploy/nginx-knackpunkt-location.conf` in den `server`-Block mit TLS einbinden, dann ist das Spiel unter `/knackpunkt/` erreichbar. Die Seite nutzt relative Pfade und läuft deshalb auch unter einem Unterpfad.
