import MapWorker from "../world/worker/MapWorker";
import System from "../System";
import SystemManager from "../SystemManager";
import Config from "../Config";

export default class MapWorkerSystem extends System {
	private workers: MapWorker[] = [];

	constructor(systemManager: SystemManager) {
		super(systemManager);

		for(let i = 0; i < Config.WebWorkersNumber; i++) {
			this.workers.push(new MapWorker());
		}
	}

	public postInit() {

	}

	public getFreeWorker(): MapWorker {
		for(let i = 0; i < this.workers.length; i++) {
			const worker = this.workers[i];

			if(worker.queueLength < 2) {
				return worker;
			}
		}

		return null;
	}

	public update(deltaTime: number) {

	}
}