package state

import (
	"slices"

	"github.com/pulumi/pulumi/sdk/v3/go/common/apitype"
	"github.com/pulumi/pulumi/sdk/v3/go/common/resource"
)

type Mutation struct {
	Remove           *MutationRemove
	RemoveDependency *MutationRemoveDependency
	RemoveProperty   *MutationRemoveProperty
}

type MutationRemove struct {
	Resource resource.URN
	Index    int
}

type MutationRemoveDependency struct {
	Resource   resource.URN
	Dependency resource.URN
}

type MutationRemoveProperty struct {
	Resource   resource.URN
	Dependency resource.URN
	Property   resource.PropertyKey
}

func Remove(target string, checkpoint *apitype.CheckpointV3) []Mutation {
	result := []Mutation{}
	for resourceIndex := len(checkpoint.Latest.Resources) - 1; resourceIndex >= 0; resourceIndex-- {
		resource := checkpoint.Latest.Resources[resourceIndex]
		if resource.URN.Name() == target {
			checkpoint.Latest.Resources = append(checkpoint.Latest.Resources[:resourceIndex], checkpoint.Latest.Resources[resourceIndex+1:]...)
			result = append(result, Mutation{
				Remove: &MutationRemove{
					Resource: resource.URN,
				},
			})
		}
	}
	muts := Repair(checkpoint)
	return append(result, muts...)
}

func Repair(checkpoint *apitype.CheckpointV3) []Mutation {
	result := []Mutation{}
	resources := map[resource.URN]bool{}
	for _, item := range checkpoint.Latest.Resources {
		resources[item.URN] = true
	}
	for _, resource := range checkpoint.Latest.Resources {
		if resource.Parent != "" {
			if _, ok := resources[resource.Parent]; !ok {
				result = append(result, Mutation{
					Remove: &MutationRemove{
						Resource: resource.URN,
					},
				})
				delete(resources, resource.URN)
				continue
			}
		}
		for _, dependency := range resource.Dependencies {
			if _, ok := resources[dependency]; !ok {
				result = append(result, Mutation{
					RemoveDependency: &MutationRemoveDependency{
						Resource:   resource.URN,
						Dependency: dependency,
					},
				})
			}
		}
		for key, dependencies := range resource.PropertyDependencies {
			for _, dependency := range dependencies {
				if _, ok := resources[dependency]; !ok {
					result = append(result, Mutation{
						RemoveProperty: &MutationRemoveProperty{
							Resource:   resource.URN,
							Dependency: dependency,
							Property:   key,
						},
					})
				}
			}
		}
	}

	for _, mut := range result {
		if mut.Remove != nil {
			checkpoint.Latest.Resources = slices.DeleteFunc(checkpoint.Latest.Resources, func(item apitype.ResourceV3) bool {
				return item.URN == mut.Remove.Resource
			})
		}

		if mut.RemoveDependency != nil {
			index := slices.IndexFunc(checkpoint.Latest.Resources, func(item apitype.ResourceV3) bool {
				return item.URN == mut.RemoveDependency.Resource
			})
			checkpoint.Latest.Resources[index].Dependencies = slices.DeleteFunc(checkpoint.Latest.Resources[index].Dependencies, func(item resource.URN) bool {
				return item == mut.RemoveDependency.Dependency
			})
		}

		if mut.RemoveProperty != nil {
			index := slices.IndexFunc(checkpoint.Latest.Resources, func(item apitype.ResourceV3) bool {
				return item.URN == mut.RemoveProperty.Resource
			})
			properties := checkpoint.Latest.Resources[index].PropertyDependencies[mut.RemoveProperty.Property]
			checkpoint.Latest.Resources[index].PropertyDependencies[mut.RemoveProperty.Property] = slices.DeleteFunc(properties, func(item resource.URN) bool {
				return item == mut.RemoveProperty.Dependency
			})
		}
	}
	return result
}
