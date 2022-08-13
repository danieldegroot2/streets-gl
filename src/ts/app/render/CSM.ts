import Object3D from "../../core/Object3D";
import PerspectiveCamera from "../../core/PerspectiveCamera";
import Vec3 from "../../math/Vec3";
import Frustum from "../../core/Frustum";
import AABB from "../../core/AABB";
import Material, {UniformType} from "../../renderer/Material";
import Texture2DArray from "../../renderer/Texture2DArray";
import CSMCascadeCamera from "~/app/render/CSMCascadeCamera";

const ShadowCameraTopOffset = 2000;
const FadeOffsetFactor = 250;

export default class CSM extends Object3D {
	private readonly camera: PerspectiveCamera;
	private readonly near: number;
	private readonly far: number;
	public readonly cascades: number;
	public readonly resolution: number;
	private readonly shadowBias: number;
	private readonly shadowNormalBias: number;
	public direction: Vec3;
	public lightIntensity = 0;
	public ambientLightIntensity = 0;

	public cascadeCameras: CSMCascadeCamera[] = [];
	private texture: Texture2DArray;
	private mainFrustum: Frustum;
	private frustums: Frustum[];
	private breaks: number[][];
	private fadeOffsets: number[];

	public constructor(
		{
			camera,
			near,
			far,
			cascades,
			resolution,
			shadowBias,
			shadowNormalBias,
			direction = new Vec3(-1, -1, -1)
		}: {
			camera: PerspectiveCamera;
			near: number;
			far: number;
			cascades: number;
			resolution: number;
			shadowBias: number;
			shadowNormalBias: number;
			direction?: Vec3;
		}
	) {
		super();

		this.camera = camera;
		this.near = near;
		this.far = far;
		this.cascades = cascades;
		this.resolution = resolution;
		this.shadowBias = shadowBias;
		this.shadowNormalBias = shadowNormalBias;
		this.direction = direction;

		this.createCameras();
		this.updateBreaks();
		this.updateFrustums();
	}

	private createCameras(): void {
		for (let i = 0; i < this.cascades; i++) {
			const camera = new CSMCascadeCamera({
				size: 0,
				near: 1,
				far: 10000
			});

			this.add(camera);
			this.cascadeCameras.push(camera);
		}
	}

	public updateFrustums(): void {
		this.mainFrustum = new Frustum(this.camera.fov, this.camera.aspect, this.near, this.far);

		this.mainFrustum.updateViewSpaceVertices();

		const newFrustumsVertices = this.mainFrustum.split(this.breaks);

		this.frustums = [];

		for (const vertices of newFrustumsVertices) {
			const frustum = new Frustum();

			frustum.setVertices(vertices);
			this.frustums.push(frustum);
		}
	}

	private updateBreaks(): void {
		const breaks = CSM.practicalSplit(this.cascades, this.near, this.far, 0.5);

		this.breaks = [];
		this.fadeOffsets = [];

		for (let i = 0; i < breaks.length; i++) {
			const prevBreak = i === 0 ? 0 : breaks[i - 1];

			this.fadeOffsets.push(breaks[i] * FadeOffsetFactor);
			this.breaks.push([prevBreak, breaks[i] + this.fadeOffsets[i] / (this.far - this.near)])
		}
	}

	public update(): void {
		this.direction = Vec3.normalize(this.direction);

		if (this.direction.equals(Vec3.Empty)) {
			this.direction.x = 1;
		}

		for (let i = 0; i < this.frustums.length; i++) {
			const worldSpaceFrustum = this.frustums[i].toSpace(this.camera.matrix);
			const cascadeCamera = this.cascadeCameras[i];

			cascadeCamera.updateMatrixWorldInverse();

			const lightSpaceFrustum = worldSpaceFrustum.toSpace(cascadeCamera.matrixWorldInverse);
			const bbox = (new AABB()).fromFrustum(lightSpaceFrustum);

			const bboxDims = bbox.getSize();
			const bboxSideSize = Math.max(bboxDims.x, bboxDims.y);
			let bboxCenter = bbox.getCenter();

			bboxCenter.z = bbox.max.z + ShadowCameraTopOffset;

			bboxCenter = Vec3.applyMatrix4(bboxCenter, cascadeCamera.matrixWorld);

			cascadeCamera.left = -bboxSideSize / 2;
			cascadeCamera.right = bboxSideSize / 2;
			cascadeCamera.top = bboxSideSize / 2;
			cascadeCamera.bottom = -bboxSideSize / 2;

			cascadeCamera.updateProjectionMatrix();

			cascadeCamera.position.set(bboxCenter.x, bboxCenter.y, bboxCenter.z);

			const target = Vec3.add(bboxCenter, this.direction);

			cascadeCamera.lookAt(target);

			cascadeCamera.updateMatrixWorld();
			cascadeCamera.updateMatrixWorldInverse();
			cascadeCamera.updateFrustum();
		}
	}

	private getBreaksForUniform(): Float32Array {
		const worldSpaceBreaks = [];

		for (let i = 0; i < this.breaks.length; i++) {
			worldSpaceBreaks.push(this.breaks[i][0] * (this.far - this.near));
			worldSpaceBreaks.push(this.breaks[i][1] * (this.far - this.near));
			worldSpaceBreaks.push(0, 0)
		}

		return new Float32Array(worldSpaceBreaks);
	}

	public getUniformsBuffers(): Record<string, Float32Array> {
		const arrays: Record<string, number[]> = {
			CSMSplits: [],
			CSMResolution: [],
			CSMSize: [],
			CSMBias: [],
			CSMMatrixWorldInverse: [],
			CSMFadeOffset: []
		};

		for (let i = 0; i < this.cascades; i++) {
			arrays.CSMMatrixWorldInverse.push(...this.cascadeCameras[i].matrixWorldInverse.values);
			arrays.CSMResolution.push(this.resolution, 0, 0, 0);
			arrays.CSMSize.push(this.cascadeCameras[i].top, 0, 0, 0);
			arrays.CSMBias.push(this.shadowBias * this.cascadeCameras[i].top, this.shadowNormalBias * this.cascadeCameras[i].top, 0, 0);
			arrays.CSMFadeOffset.push(this.fadeOffsets[i], 0, 0, 0);
		}

		arrays.CSMSplits.push(...this.getBreaksForUniform());

		return {
			CSMLightDirectionAndIntensity: new Float32Array([...Vec3.toArray(this.direction), this.lightIntensity]),
			CSMSplits: new Float32Array(arrays.CSMSplits),
			CSMResolution: new Float32Array(arrays.CSMResolution),
			CSMSize: new Float32Array(arrays.CSMSize),
			CSMBias: new Float32Array(arrays.CSMBias),
			CSMMatrixWorldInverse: new Float32Array(arrays.CSMMatrixWorldInverse),
			CSMFadeOffset: new Float32Array(arrays.CSMFadeOffset)
		};
	}

	private static uniformSplit(splits: number, near: number, far: number): number[] {
		const r = [];

		for (let i = 1; i < splits; i++) {
			r.push((near + (far - near) * i / splits) / far);
		}

		r.push(1);

		return r;
	}

	private static logarithmicSplit(splits: number, near: number, far: number): number[] {
		const r = [];

		for (let i = 1; i < splits; i++) {
			r.push((near * (far / near) ** (i / splits)) / far);
		}

		r.push(1);

		return r;
	}

	private static practicalSplit(splits: number, near: number, far: number, lambda: number): number[] {
		const log = CSM.logarithmicSplit(splits, near, far);
		const uni = CSM.uniformSplit(splits, near, far);
		const r = [];

		for (let i = 1; i < splits; i++) {
			r.push(lambda * log[i - 1] + (1 - lambda) * uni[i - 1]);
		}

		r.push(1);

		return r;
	}
}