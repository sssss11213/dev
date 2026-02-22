import * as THREE from 'three';

const mapFileContent = fetch("maps/test.map").then((response) => response.text());

export class QuakeMapParser {
    *parse() {
    const lines = this.content.split(/\r?\n/);


    let currentBrushSketch = null;
    let currentEntitySketch = null;

    // 2. Iterate over each line.
    for (let lineno = 0; lineno < lines.length; lineno += 1) {
        const line = lines[lineno];

        // 2.1. If the line is a comment, then ignore it.
        if (line.startsWith("//") || line.trim().length < 1) {
        continue;
        }

        // 3. If the line is an opening bracket:
        if (line.startsWith("{")) {
        // 3.1. Start current brush buffer and store the current line inside it.
        if (currentEntitySketch) {
            currentBrushSketch = [];
            continue;
        // 3.2. If you are not inside the entity definition, start a new entity buffer.
        } else if (!currentEntitySketch) {
            currentEntitySketch = {
            brushes: [],
            props: [],
            };
            continue;
        // 3.1.1. If you already are inside the brush definition, then it is an error.
        } else {
            throw new Error("Unexpected opening bracket.");
        }
        }

        // 2.4 If it is a closing bracket: 
        if (line.startsWith("}")) {
        // 2.4.1. If you have an opened brush buffer, then close it and save the brush.
        if (currentBrushSketch) {
            if (!currentEntitySketch) {
            throw new Error("Expected brush to be nested inside entity");
            }
            currentEntitySketch.brushes.push(new QuakeBrush(breadcrumbs.add("QuakeBrush"), currentBrushSketch));
            currentBrushSketch = null;
            continue;
        // 2.4.2. If you do not have an opened brush buffer:
        } else if (currentEntitySketch) {
            // 2.4.2.2. If you are inside the entity definition, then the entity definition is complete.
            yield {
            brushes: currentEntitySketch.brushes,
            properties: currentEntitySketch.props,
            }

            currentEntitySketch = null;
            continue;
        } else {
            // 2.4.2.1. If you are not inside the entity definition, then it is an error.
            throw new Error("Unexpected closing bracket.");
        }
        }

        if (currentBrushSketch) {
        // 5. If you are inside the brush, then it is the half-space definition.
        currentBrushSketch.push(line);
        continue;
        }

        // 6. If you are inside the entity, but not in a brush, then it's the entity property.
        if (currentEntitySketch) {
        currentEntitySketch.props.push(line);
        continue;
        }

        throw new Error("Unexpected line.");
    }

    // these two protect us from corrupted maps
    if (currentBrushSketch) {
        throw new Error("Unexpected end of brush data.");
    }

    if (currentEntitySketch) {
        throw new Error("Unexpected end of entity data.");
    }
    }
}

async function loadAndParseMap() {
    THREE.log("Loading map...");
    const response = await fetch("maps/test.map");
    if (!response.ok) throw new Error("Failed to load map: " + response.status);

    const text = await response.text();

    const parser = new QuakeMapParser();
    parser.content = text;               // ← now it's really a string

    THREE.log("Parsing map...");
    for (const entity of parser.parse()) {    // ← no await needed here
        THREE.log("Entity:", entity);
    }
}

loadAndParseMap().catch(err => {
    console.error("Map loading/parsing failed:", err);
});